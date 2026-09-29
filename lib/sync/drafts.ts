import type { gmail_v1 } from "@googleapis/gmail";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { drafts, threads } from "@/lib/db/schema";
import { formatAddressList } from "@/lib/mail/address";
import { parseGmailMessage } from "@/lib/mail/mime";

export type RemoteDraft = { gmailDraftId: string; gmailMessageId: string };

// The slice of Gmail drafts sync reads. Tests mock it.
export interface GmailDraftsPort {
  listDrafts(): Promise<RemoteDraft[]>;
  // Null when the draft no longer exists.
  getDraft(gmailDraftId: string): Promise<gmail_v1.Schema$Message | null>;
}

type LocalDraft = { id: string; gmailDraftId: string; gmailMessageId: string; updatedAt: Date };

/**
 * What a pass does: fetch drafts that are new or changed in Gmail, remove the ones Gmail no longer
 * has (sent or deleted elsewhere). A row written here after the pass started is left alone, since
 * Gmail's listing may predate it.
 */
export function planDrafts(remote: RemoteDraft[], local: LocalDraft[], passStart: Date) {
  const byDraftId = new Map(local.map((d) => [d.gmailDraftId, d]));
  const remoteIds = new Set(remote.map((d) => d.gmailDraftId));
  return {
    fetch: remote.filter((r) => byDraftId.get(r.gmailDraftId)?.gmailMessageId !== r.gmailMessageId).map((r) => r.gmailDraftId),
    remove: local.filter((d) => !remoteIds.has(d.gmailDraftId) && d.updatedAt < passStart).map((d) => d.id),
  };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

/** Mirrors the account's Gmail drafts into `drafts`. Returns how many were stored and removed. */
export async function syncDrafts(db: Db, gmail: GmailDraftsPort, accountId: string, now = new Date()) {
  const remote = await gmail.listDrafts();
  const local = await db
    .select({ id: drafts.id, gmailDraftId: drafts.gmailDraftId, gmailMessageId: drafts.gmailMessageId, updatedAt: drafts.updatedAt })
    .from(drafts)
    .where(eq(drafts.accountId, accountId));
  const plan = planDrafts(remote, local, now);

  let stored = 0;
  for (const gmailDraftId of plan.fetch) {
    const message = await gmail.getDraft(gmailDraftId);
    if (!message) continue;
    const m = parseGmailMessage(message);
    const [thread] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.accountId, accountId), eq(threads.gmailThreadId, m.gmailThreadId)));
    const values = {
      gmailMessageId: m.gmailMessageId,
      threadId: thread?.id ?? null,
      mode: thread ? (/^fwd?:/i.test(m.subject ?? "") ? "forward" : "reply") : "new",
      to: formatAddressList(m.to),
      cc: formatAddressList(m.cc),
      bcc: formatAddressList(m.bcc),
      subject: m.subject ?? "",
      html: m.htmlSanitized ?? escapeHtml(m.text ?? ""),
      composed: false,
      date: m.date,
    } as const;
    await db
      .insert(drafts)
      .values({ accountId, gmailDraftId, ...values })
      .onConflictDoUpdate({
        target: [drafts.accountId, drafts.gmailDraftId],
        set: { ...values, updatedAt: sql`now()` },
        // Compose saved it after this pass began: that copy is newer.
        setWhere: lt(drafts.updatedAt, now),
      });
    stored++;
  }
  if (plan.remove.length) await db.delete(drafts).where(inArray(drafts.id, plan.remove));
  return { stored, removed: plan.remove.length };
}
