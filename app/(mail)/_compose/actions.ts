"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { accounts, type Address } from "@/lib/db/schema";
import { ReauthRequiredError } from "@/lib/gmail/client";
import {
  fetchAttachment,
  fetchReplyHeaders,
  sendMessage,
  type OutgoingAttachment,
  type ReplyHeaders,
} from "@/lib/gmail/send";
import { formatAddressList, parseRecipients } from "@/lib/mail/address";

import {
  composeSubject,
  findRecipients,
  forwardBlock,
  listComposeAccounts,
  loadComposeThread,
  quoteBlock,
  quotingLabel,
  replyRecipients,
  signatureBlock,
  type ComposeThread,
} from "./server";
import type { ComposeInit, ComposeMode, ComposeSend, SendResult } from "./types";

const MODES = ["new", "reply", "reply-all", "forward"] as const;
// Gmail rejects messages over 35 MB once encoded; base64 grows data by a third.
const MAX_HTML_BYTES = 24 * 1024 * 1024;

/** Reply-To and threading headers straight from Gmail. Null when the account can't be reached. */
async function liveHeaders(ctx: ComposeThread): Promise<ReplyHeaders | null> {
  if (!ctx.account.refreshTokenEnc) return null;
  try {
    return await fetchReplyHeaders(ctx.account.id, ctx.target.gmailMessageId);
  } catch (error) {
    console.error("compose: could not read reply headers", error);
    return null;
  }
}

export async function prepareCompose(mode: ComposeMode, threadId: string | null): Promise<ComposeInit | null> {
  if (!MODES.includes(mode)) return null;
  const accountList = await listComposeAccounts();
  const blank: ComposeInit = {
    mode: "new",
    threadId: null,
    accounts: accountList,
    accountId: null,
    to: "",
    cc: "",
    subject: "",
    quoting: null,
    attachments: [],
  };
  if (mode === "new" || !threadId) return blank;

  const ctx = await loadComposeThread(threadId);
  if (!ctx) return null;
  const base = {
    ...blank,
    mode,
    threadId,
    accountId: ctx.account.id,
    subject: composeSubject(mode, ctx.target.subject ?? ctx.thread.subject),
    quoting: quotingLabel(ctx.target),
  };

  if (mode === "forward") {
    return {
      ...base,
      attachments: ctx.target.attachments
        .filter((a) => !a.contentId)
        .map((a) => ({ id: a.id, filename: a.filename, size: a.size })),
    };
  }

  const headers = ctx.target.isInbound ? await liveHeaders(ctx) : null;
  const replyTo = headers?.replyTo ? parseRecipients(headers.replyTo).addresses : [];
  const { to, cc } = replyRecipients(mode, ctx.target, ctx.account.email, replyTo);
  return { ...base, to: formatAddressList(to), cc: formatAddressList(cc) };
}

const SendInput = z.object({
  mode: z.enum(MODES),
  threadId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  to: z.string().max(10_000),
  cc: z.string().max(10_000),
  bcc: z.string().max(10_000),
  subject: z.string().max(1_000),
  html: z.string(),
  attachmentIds: z.array(z.uuid()).max(100),
});

function recipients(field: string, value: string): Address[] | string {
  const { addresses, invalid } = parseRecipients(value);
  return invalid.length ? `${field}: not an address, ${invalid[0]}` : addresses;
}

export async function sendCompose(input: ComposeSend): Promise<SendResult> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "could not read the message, retry" };
  const data = parsed.data;
  if (Buffer.byteLength(data.html) > MAX_HTML_BYTES) return { ok: false, error: "message too large, remove images" };

  const to = recipients("to", data.to);
  const cc = recipients("cc", data.cc);
  const bcc = recipients("bcc", data.bcc);
  for (const r of [to, cc, bcc]) if (typeof r === "string") return { ok: false, error: r };
  const [toList, ccList, bccList] = [to, cc, bcc] as Address[][];
  if (!toList.length && !ccList.length && !bccList.length) return { ok: false, error: "add a recipient" };

  let accountId: string;
  let accountLabel: string;
  let signatureHtml: string | null;
  let subject = data.subject.trim();
  let gmailThreadId: string | undefined;
  let tail = "";
  let threading: { inReplyTo?: string; references?: string } = {};
  let files: OutgoingAttachment[] = [];
  let work = false;

  if (data.mode === "new") {
    if (!data.accountId) return { ok: false, error: "pick an account" };
    const [account] = await db
      .select({ id: accounts.id, label: accounts.label, signatureHtml: accounts.signatureHtml })
      .from(accounts)
      .where(eq(accounts.id, data.accountId));
    if (!account) return { ok: false, error: "account not found, reload" };
    ({ id: accountId, label: accountLabel, signatureHtml } = account);
  } else {
    if (!data.threadId) return { ok: false, error: "thread not found, reload" };
    const ctx = await loadComposeThread(data.threadId);
    if (!ctx) return { ok: false, error: "thread not found, reload" };
    // Replies and forwards always leave from the account that holds the thread.
    ({ id: accountId, label: accountLabel, signatureHtml } = ctx.account);
    work = data.mode !== "forward" && ctx.thread.workAt !== null;
    gmailThreadId = ctx.thread.gmailThreadId;
    // Reply subjects are derived, never typed, so Gmail keeps the thread together.
    if (data.mode !== "forward" || !subject) subject = composeSubject(data.mode, ctx.target.subject ?? ctx.thread.subject);
    tail = data.mode === "forward" ? forwardBlock(ctx.target) : quoteBlock(ctx.target);

    const stored = ctx.target.headers;
    const live = stored.messageId ? null : await liveHeaders(ctx);
    const messageId = stored.messageId ?? live?.messageId ?? null;
    const references = stored.references ?? live?.references ?? null;
    if (messageId) {
      threading = { inReplyTo: messageId, references: references ? `${references} ${messageId}` : messageId };
    }

    // Inline images always travel with the forwarded body; files only when kept.
    const wanted =
      data.mode === "forward"
        ? ctx.target.attachments.filter((a) => a.contentId || data.attachmentIds.includes(a.id))
        : [];
    if (wanted.length) {
      try {
        files = await Promise.all(
          wanted.map(async (a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            contentId: a.contentId ?? undefined,
            data: await fetchAttachment(accountId, ctx.target.gmailMessageId, a.gmailAttachmentId),
          })),
        );
      } catch (error) {
        console.error("compose: attachment fetch failed", error);
        return {
          ok: false,
          error:
            error instanceof ReauthRequiredError
              ? `send failed, reconnect ${accountLabel} in settings`
              : "could not fetch attachments, retry",
        };
      }
    }
  }

  try {
    await sendMessage(
      accountId,
      {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        html: `${data.html}${signatureBlock(signatureHtml)}${tail ? `<br>${tail}` : ""}`,
        ...threading,
        attachments: files,
      },
      gmailThreadId,
    );
  } catch (error) {
    console.error("compose: send failed", error);
    if (error instanceof ReauthRequiredError) {
      return { ok: false, error: `send failed, reconnect ${accountLabel} in settings` };
    }
    return { ok: false, error: `send failed for ${accountLabel}, retry` };
  }

  return { ok: true, accountId, accountLabel, work };
}

const SuggestInput = z.object({
  query: z.string().trim().min(1).max(200),
  exclude: z.array(z.string().max(320)).max(200),
});

/** Recipient suggestions for what is being typed, minus the addresses already in the field. */
export async function suggestRecipients(query: string, exclude: string[]): Promise<Address[]> {
  const parsed = SuggestInput.safeParse({ query, exclude });
  if (!parsed.success) return [];
  return findRecipients(parsed.data.query, parsed.data.exclude);
}
