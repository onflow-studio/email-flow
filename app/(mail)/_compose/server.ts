import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, attachments, messages, threads, type Address } from "@/lib/db/schema";
import { htmlToPlainText } from "@/lib/gmail/send";
import { mergeTimeline, replyCopy } from "@/lib/sync/twins";

import type { ComposeAccount, ComposeMode } from "./types";

export async function listComposeAccounts(): Promise<ComposeAccount[]> {
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      label: accounts.label,
      color: accounts.color,
      signatureHtml: accounts.signatureHtml,
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
  return rows.map(({ signatureHtml, ...a }) => ({
    ...a,
    signature: signatureHtml ? htmlToPlainText(signatureHtml).replace(/\s+/g, " ") || null : null,
  }));
}

/**
 * Twins: a reply leaves from the copy in the account the latest inbound message was addressed to,
 * so it answers from the address the sender wrote to. Without twins, the thread itself.
 */
async function composeCopy(threadId: string): Promise<string> {
  const [opened] = await db.select({ groupId: threads.groupId }).from(threads).where(eq(threads.id, threadId));
  if (!opened?.groupId) return threadId;
  const copies = await db.query.threads.findMany({
    where: eq(threads.groupId, opened.groupId),
    columns: { id: true },
    with: {
      account: { columns: { email: true } },
      messages: { columns: { id: true, date: true, to: true, cc: true, isInbound: true, headers: true } },
    },
  });
  const timeline = mergeTimeline(copies.map((c) => c.messages.map((m) => ({ ...m, messageId: m.headers.messageId }))));
  return replyCopy(
    copies.map((c) => ({ id: c.id, accountEmail: c.account.email })),
    timeline.findLast((m) => m.isInbound),
    threadId,
  );
}

/** The thread's account and the message a reply or forward answers: the latest non-draft one. */
export async function loadComposeThread(threadId: string) {
  const thread = await db.query.threads.findFirst({
    where: eq(threads.id, await composeCopy(threadId)),
    columns: { id: true, gmailThreadId: true, subject: true },
    with: {
      account: {
        columns: { id: true, email: true, label: true, signatureHtml: true, refreshTokenEnc: true },
      },
      messages: {
        orderBy: asc(messages.date),
        columns: {
          id: true,
          gmailMessageId: true,
          fromEmail: true,
          fromName: true,
          to: true,
          cc: true,
          subject: true,
          date: true,
          htmlSanitized: true,
          text: true,
          isInbound: true,
          gmailLabels: true,
          headers: true,
        },
        with: {
          attachments: {
            columns: { id: true, filename: true, mimeType: true, size: true, gmailAttachmentId: true, contentId: true },
            orderBy: asc(attachments.filename),
          },
        },
      },
    },
  });
  if (!thread) return null;
  const target = thread.messages.filter((m) => !m.gmailLabels.includes("DRAFT")).at(-1);
  if (!target) return null;
  return { thread, account: thread.account, target };
}

export type ComposeThread = NonNullable<Awaited<ReturnType<typeof loadComposeThread>>>;
type Target = ComposeThread["target"];

function uniqueExcept(list: Address[], exclude: Set<string>): Address[] {
  const seen = new Set(exclude);
  return list.filter((a) => {
    const email = a.email.toLowerCase();
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

/**
 * Reply goes to whoever the target came from (its Reply-To when set), or back to
 * its recipients when it was our own message. Reply all adds everyone else on it,
 * minus the account itself.
 */
export function replyRecipients(
  mode: Extract<ComposeMode, "reply" | "reply-all">,
  target: Pick<Target, "fromEmail" | "fromName" | "to" | "cc" | "isInbound">,
  accountEmail: string,
  replyTo: Address[] = [],
): { to: Address[]; cc: Address[] } {
  const me = new Set([accountEmail.toLowerCase()]);
  const from: Address[] = replyTo.length ? replyTo : [{ name: target.fromName, email: target.fromEmail }];
  const primary = target.isInbound ? from : target.to;
  if (mode === "reply") return { to: uniqueExcept(primary, me), cc: [] };

  const to = uniqueExcept(target.isInbound ? [...from, ...target.to] : target.to, me);
  const cc = uniqueExcept(target.cc, new Set([...me, ...to.map((a) => a.email.toLowerCase())]));
  return to.length ? { to, cc } : { to: cc, cc: [] };
}

export function composeSubject(mode: ComposeMode, subject: string | null): string {
  const base = (subject ?? "").trim();
  if (mode === "forward") return /^(fwd?|fw):/i.test(base) ? base : `Fwd: ${base}`;
  if (mode === "reply" || mode === "reply-all") return /^re:/i.test(base) ? base : `Re: ${base}`;
  return base;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const formatAddress = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function originalBody(target: Target): string {
  if (target.htmlSanitized) return target.htmlSanitized;
  return `<div style="white-space:pre-wrap">${escapeHtml(target.text ?? "")}</div>`;
}

/** Gmail-style quote so Gmail collapses it behind the ellipsis. */
export function quoteBlock(target: Target): string {
  const who = escapeHtml(formatAddress({ name: target.fromName, email: target.fromEmail }));
  return (
    `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On ${escapeHtml(formatDate(target.date))}, ${who} wrote:<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${originalBody(target)}</blockquote></div>`
  );
}

export function forwardBlock(target: Target): string {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${formatAddress({ name: target.fromName, email: target.fromEmail })}`,
    `Date: ${formatDate(target.date)}`,
    `Subject: ${target.subject ?? ""}`,
    `To: ${target.to.map(formatAddress).join(", ")}`,
    ...(target.cc.length ? [`Cc: ${target.cc.map(formatAddress).join(", ")}`] : []),
  ];
  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${lines.map(escapeHtml).join("<br>")}<br></div><br>${originalBody(target)}</div>`;
}

export function signatureBlock(signatureHtml: string | null): string {
  return signatureHtml ? `<br><div class="gmail_signature">${signatureHtml}</div>` : "";
}

/** `laura, 25 sep` */
export function quotingLabel(target: Target): string {
  const who = target.isInbound ? target.fromName || target.fromEmail : "me";
  const when = target.date.toLocaleDateString("en-US", { day: "numeric", month: "short" }).toLowerCase();
  return `${who}, ${when}`;
}
