import type { gmail_v1 } from "@googleapis/gmail";

import type { GmailSyncPort } from "./gmail";

// First sync of an account only looks back this far. Older mail is the backfill's job.
export const INITIAL_WINDOW_DAYS = 14;
// Stale-cursor fallback re-reads a little before the last good sync to cover clock skew.
export const FALLBACK_OVERLAP_MS = 60 * 60_000;

export type ChangeMode = "initial" | "history" | "fallback";

export type Changes = {
  mode: ChangeMode;
  gmailThreadIds: string[];
  cursor: string;
};

// Every thread touched by a history page: new, deleted, or relabelled messages.
export function historyThreadIds(history: gmail_v1.Schema$History[]): string[] {
  const ids = new Set<string>();
  for (const record of history) {
    const messages = [
      ...(record.messagesAdded ?? []),
      ...(record.messagesDeleted ?? []),
      ...(record.labelsAdded ?? []),
      ...(record.labelsRemoved ?? []),
    ].map((entry) => entry.message);
    for (const m of messages) if (m?.threadId) ids.add(m.threadId);
  }
  return [...ids];
}

export function fallbackQuery(lastSyncAt: Date | null, now: Date): string {
  const since = lastSyncAt
    ? new Date(lastSyncAt.getTime() - FALLBACK_OVERLAP_MS)
    : new Date(now.getTime() - INITIAL_WINDOW_DAYS * 86_400_000);
  // `after:` takes epoch seconds.
  return `after:${Math.floor(since.getTime() / 1000)}`;
}

async function listAll(gmail: GmailSyncPort, query: string): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await gmail.listThreadIds(query, pageToken);
    page.threadIds.forEach((id) => ids.add(id));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return [...ids];
}

// Which threads changed since the cursor, and the cursor to store once they are ingested.
export async function collectChanges(
  gmail: GmailSyncPort,
  account: { historyId: string | null; lastSyncAt: Date | null },
  now = new Date(),
): Promise<Changes> {
  if (account.historyId) {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let cursor = account.historyId;
    let stale = false;
    do {
      const page = await gmail.listHistory(account.historyId, pageToken);
      if (!page) {
        stale = true;
        break;
      }
      historyThreadIds(page.history).forEach((id) => ids.add(id));
      cursor = page.historyId;
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    if (!stale) return { mode: "history", gmailThreadIds: [...ids], cursor };
  }

  // Take the cursor before listing so nothing arriving mid-list is skipped next pass.
  const { historyId } = await gmail.getProfile();
  const mode: ChangeMode = account.historyId ? "fallback" : "initial";
  const since = mode === "initial" ? null : account.lastSyncAt;
  return { mode, gmailThreadIds: await listAll(gmail, fallbackQuery(since, now)), cursor: historyId };
}
