import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { accounts, type Account } from "@/lib/db/schema";

import { collectChanges, type ChangeMode } from "./changes";
import type { GmailSyncPort } from "./gmail";
import type { JobContext } from "./jobs";
import { processJobs, type JobCounts } from "./queue";
import { ingestThread } from "./store";

// Gmail allows ~250 quota units per user per second; a thread plus its messages is ~10-30.
const THREAD_CONCURRENCY = 4;

export type SyncResult = {
  mode: ChangeMode;
  threads: number;
  created: number;
  newMessages: number;
  classifyQueued: number;
  jobs: JobCounts;
};

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// One pass for one account, per TECH-PLAN "Sync pipeline". The cursor only moves once every
// changed thread is stored, so a failure re-reads the same changes next pass instead of losing them.
export async function syncAccount(
  db: Db,
  account: Pick<Account, "id" | "email" | "historyId" | "lastSyncAt">,
  gmail: GmailSyncPort,
  jobContext: JobContext,
  now = new Date(),
): Promise<SyncResult> {
  const changes = await collectChanges(gmail, account, now);
  const ingested = await mapLimit(changes.gmailThreadIds, THREAD_CONCURRENCY, (id) =>
    ingestThread(db, gmail, account, id, now),
  );

  await db
    .update(accounts)
    .set({ historyId: changes.cursor, lastSyncAt: now, lastSyncError: null })
    .where(eq(accounts.id, account.id));

  const stored = ingested.flatMap((r) => (r.status === "stored" ? [r] : []));
  return {
    mode: changes.mode,
    threads: changes.gmailThreadIds.length,
    created: stored.filter((r) => r.created).length,
    newMessages: stored.reduce((n, r) => n + r.newMessages, 0),
    classifyQueued: stored.filter((r) => r.classify).length,
    jobs: await processJobs(account.id, jobContext),
  };
}
