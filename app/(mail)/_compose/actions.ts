"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { accounts, drafts, type Address, type Draft } from "@/lib/db/schema";
import { ReauthRequiredError } from "@/lib/gmail/client";
import { deleteGmailDraft, saveGmailDraft } from "@/lib/gmail/drafts";
import { httpStatus } from "@/lib/gmail/errors";
import {
  fetchAttachment,
  fetchReplyHeaders,
  sendMessage,
  type OutgoingAttachment,
  type OutgoingMessage,
  type ReplyHeaders,
} from "@/lib/gmail/send";
import { formatAddressList, parseRecipients } from "@/lib/mail/address";
import { getGmailSyncAdapter } from "@/lib/sync/gmail";
import { ingestThread } from "@/lib/sync/store";

import {
  bodyBlock,
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
import type { ComposeInit, ComposeMode, ComposeSend, DraftResult, SendResult } from "./types";

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

/** A draft to resume: the one asked for, or one already started for this thread in this mode. */
async function findDraft(mode: ComposeMode, threadId: string | null, draftId: string | null): Promise<Draft | null> {
  if (draftId) return (await db.query.drafts.findFirst({ where: eq(drafts.id, draftId) })) ?? null;
  if (mode === "new" || !threadId) return null;
  return (
    (await db.query.drafts.findFirst({
      where: and(eq(drafts.threadId, threadId), eq(drafts.mode, mode)),
      orderBy: desc(drafts.date),
    })) ?? null
  );
}

export async function prepareCompose(
  mode: ComposeMode,
  threadId: string | null,
  draftId: string | null = null,
): Promise<ComposeInit | null> {
  if (!MODES.includes(mode)) return null;
  const draft = await findDraft(mode, threadId, draftId);
  if (draftId && !draft) return null;
  if (draft) {
    // A reply whose thread is gone carries on as a new message.
    mode = draft.threadId ? draft.mode : "new";
    threadId = draft.threadId;
  }

  const accountList = await listComposeAccounts();
  const blank: ComposeInit = {
    mode: "new",
    threadId: null,
    draftId: draft?.id ?? null,
    accounts: accountList,
    accountId: draft?.accountId ?? null,
    to: draft?.to ?? "",
    cc: draft?.cc ?? "",
    bcc: draft?.bcc ?? "",
    subject: draft?.subject ?? "",
    html: draft?.html ?? "",
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
    subject: draft?.subject || composeSubject(mode, ctx.target.subject ?? ctx.thread.subject),
    // A draft written elsewhere already holds the quote.
    quoting: draft && !draft.composed ? null : quotingLabel(ctx.target),
  };

  if (mode === "forward") {
    return {
      ...base,
      attachments: ctx.target.attachments
        .filter((a) => !a.contentId)
        .map((a) => ({ id: a.id, filename: a.filename, size: a.size })),
    };
  }
  if (draft) return base;

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
  draftId: z.uuid().nullable(),
});
type Input = z.infer<typeof SendInput>;

function recipients(field: string, value: string): Address[] | string {
  const { addresses, invalid } = parseRecipients(value);
  return invalid.length ? `${field}: not an address, ${invalid[0]}` : addresses;
}

type Assembled = {
  accountId: string;
  accountLabel: string;
  gmailThreadId?: string;
  message: OutgoingMessage;
  work: boolean;
  ctx: ComposeThread | null;
};

/**
 * The outgoing message for a compose form: account, subject, body with signature and quote,
 * threading headers. `composed: false` sends the body as it is (a draft written elsewhere).
 */
async function assemble(data: Input, recipients: [Address[], Address[], Address[]], composed: boolean): Promise<Assembled | string> {
  const [to, cc, bcc] = recipients;
  let subject = data.subject.trim();

  if (data.mode === "new") {
    if (!data.accountId) return "pick an account";
    const [account] = await db
      .select({ id: accounts.id, label: accounts.label, signatureHtml: accounts.signatureHtml })
      .from(accounts)
      .where(eq(accounts.id, data.accountId));
    if (!account) return "account not found, reload";
    const html = composed ? `${bodyBlock(data.html)}${signatureBlock(account.signatureHtml)}` : data.html;
    return {
      accountId: account.id,
      accountLabel: account.label,
      message: { to, cc, bcc, subject, html },
      work: false,
      ctx: null,
    };
  }

  if (!data.threadId) return "thread not found, reload";
  const ctx = await loadComposeThread(data.threadId);
  if (!ctx) return "thread not found, reload";
  // Reply subjects are derived, never typed, so Gmail keeps the thread together.
  if (data.mode !== "forward" || !subject) subject = composeSubject(data.mode, ctx.target.subject ?? ctx.thread.subject);
  const tail = data.mode === "forward" ? forwardBlock(ctx.target) : quoteBlock(ctx.target);

  const stored = ctx.target.headers;
  const live = stored.messageId ? null : await liveHeaders(ctx);
  const messageId = stored.messageId ?? live?.messageId ?? null;
  const references = stored.references ?? live?.references ?? null;
  const threading = messageId
    ? { inReplyTo: messageId, references: references ? `${references} ${messageId}` : messageId }
    : {};

  const html = composed ? `${bodyBlock(data.html)}${signatureBlock(ctx.account.signatureHtml)}${tail ? `<br>${tail}` : ""}` : data.html;
  return {
    // Replies and forwards always leave from the account that holds the thread.
    accountId: ctx.account.id,
    accountLabel: ctx.account.label,
    gmailThreadId: ctx.thread.gmailThreadId,
    message: { to, cc, bcc, subject, html, ...threading },
    work: data.mode !== "forward" && ctx.thread.workAt !== null,
    ctx,
  };
}

async function draftRow(draftId: string | null): Promise<Draft | null> {
  if (!draftId) return null;
  return (await db.query.drafts.findFirst({ where: eq(drafts.id, draftId) })) ?? null;
}

async function dropDraft(draft: Draft): Promise<void> {
  await deleteGmailDraft(draft.accountId, draft.gmailDraftId);
  await db.delete(drafts).where(eq(drafts.id, draft.id));
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
  const lists = [to, cc, bcc] as [Address[], Address[], Address[]];
  if (!lists.some((l) => l.length)) return { ok: false, error: "add a recipient" };

  const draft = await draftRow(data.draftId);
  const built = await assemble(data, lists, draft?.composed ?? true);
  if (typeof built === "string") return { ok: false, error: built };
  const { accountId, accountLabel, ctx } = built;

  let files: OutgoingAttachment[] = [];
  // Inline images always travel with the forwarded body; files only when kept.
  const wanted =
    data.mode === "forward" && ctx
      ? ctx.target.attachments.filter((a) => a.contentId || data.attachmentIds.includes(a.id))
      : [];
  if (ctx && wanted.length) {
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

  let sent: Awaited<ReturnType<typeof sendMessage>>;
  try {
    sent = await sendMessage(accountId, { ...built.message, attachments: files }, built.gmailThreadId);
  } catch (error) {
    console.error("compose: send failed", error);
    if (error instanceof ReauthRequiredError) {
      return { ok: false, error: `send failed, reconnect ${accountLabel} in settings` };
    }
    return { ok: false, error: `send failed for ${accountLabel}, retry` };
  }

  // Stored now so the reply shows in its thread at once; otherwise the next sync brings it in.
  await storeSent(accountId, sent.gmailThreadId).catch((error) => console.error("compose: could not store sent message", error));
  if (draft) {
    // Sent is sent; a leftover draft only clutters, so a failure here is logged, not shown.
    await dropDraft(draft).catch((error) => console.error("compose: could not remove sent draft", error));
  }
  return { ok: true, accountId, accountLabel, work: built.work };
}

async function storeSent(accountId: string, gmailThreadId: string): Promise<void> {
  const [account] = await db.select({ id: accounts.id, email: accounts.email }).from(accounts).where(eq(accounts.id, accountId));
  if (!account) return;
  await ingestThread(db, await getGmailSyncAdapter(accountId), account, gmailThreadId);
}

/** Saves the form as a Gmail draft in its account, creating it on the first save. */
export async function saveDraft(input: ComposeSend): Promise<DraftResult> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "draft not saved" };
  const data = parsed.data;
  if (Buffer.byteLength(data.html) > MAX_HTML_BYTES) return { ok: false, error: "draft too large, remove images" };

  // Half-typed addresses stay in the form and the row, just not in the Gmail draft.
  const lists = [data.to, data.cc, data.bcc].map((v) => parseRecipients(v).addresses) as [Address[], Address[], Address[]];
  const existing = await draftRow(data.draftId);
  const built = await assemble(data, lists, existing?.composed ?? true);
  if (typeof built === "string") return { ok: false, error: built };

  // A new message moved to another account: its draft moves with it.
  let gmailDraftId = existing?.gmailDraftId ?? null;
  if (existing && existing.accountId !== built.accountId) {
    await deleteGmailDraft(existing.accountId, existing.gmailDraftId).catch(() => {});
    gmailDraftId = null;
  }

  let saved;
  try {
    try {
      saved = await saveGmailDraft(built.accountId, gmailDraftId, built.message, built.gmailThreadId);
    } catch (error) {
      // Sent or deleted elsewhere since: start a fresh one.
      if (!gmailDraftId || httpStatus(error) !== 404) throw error;
      saved = await saveGmailDraft(built.accountId, null, built.message, built.gmailThreadId);
    }
  } catch (error) {
    console.error("compose: draft save failed", error);
    return {
      ok: false,
      error: error instanceof ReauthRequiredError ? `draft not saved, reconnect ${built.accountLabel}` : "draft not saved",
    };
  }

  const values = {
    accountId: built.accountId,
    gmailDraftId: saved.gmailDraftId,
    gmailMessageId: saved.gmailMessageId,
    threadId: data.mode === "new" ? null : data.threadId,
    mode: data.mode,
    to: data.to,
    cc: data.cc,
    bcc: data.bcc,
    subject: data.subject,
    html: data.html,
    date: new Date(),
  };
  if (existing) {
    await db.update(drafts).set(values).where(eq(drafts.id, existing.id));
    return { ok: true, draftId: existing.id };
  }
  const [row] = await db
    .insert(drafts)
    .values(values)
    .onConflictDoUpdate({ target: [drafts.accountId, drafts.gmailDraftId], set: { ...values, composed: true } })
    .returning({ id: drafts.id });
  return { ok: true, draftId: row.id };
}

/** Deletes the draft here and in Gmail. */
export async function discardDraft(draftId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(draftId).success) return { ok: false };
  const draft = await draftRow(draftId);
  if (!draft) return { ok: true };
  try {
    await dropDraft(draft);
    return { ok: true };
  } catch (error) {
    console.error("compose: draft discard failed", error);
    return { ok: false };
  }
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
