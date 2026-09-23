import type { gmail_v1 } from "@googleapis/gmail";

import type { CatchUpState } from "@/lib/db/schema";

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
  // Set when there is no usable cursor: the listing to work through, a page at a time.
  catchUp: CatchUpState | null;
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

// What a listing sync has to cover: since the last good sync, or the initial window on a first sync.
export function newCatchUp(mode: CatchUpState["mode"], lastSyncAt: Date | null, now: Date): CatchUpState {
  const since = lastSyncAt
    ? new Date(lastSyncAt.getTime() - FALLBACK_OVERLAP_MS)
    : new Date(now.getTime() - INITIAL_WINDOW_DAYS * 86_400_000);
  return {
    mode,
    // `after:` and `before:` take epoch seconds.
    after: Math.floor(since.getTime() / 1000),
    before: Math.ceil(now.getTime() / 1000),
    pageToken: null,
    offset: 0,
    seen: 0,
  };
}

// Which threads changed since the cursor, and the cursor to store once they are ingested. Without a
// usable cursor, a fresh one plus a catch-up listing: the listing can take several passes, and the
// cursor covers anything that arrives meanwhile.
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
    if (!stale) return { mode: "history", gmailThreadIds: [...ids], cursor, catchUp: null };
  }

  const { historyId } = await gmail.getProfile();
  const mode = account.historyId ? "fallback" : "initial";
  return {
    mode,
    gmailThreadIds: [],
    cursor: historyId,
    catchUp: newCatchUp(mode, mode === "initial" ? null : account.lastSyncAt, now),
  };
}
