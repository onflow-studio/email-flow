import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { accounts, type Account, type CatchUpState } from "@/lib/db/schema";

import { CATCH_UP_THREADS_PER_PASS, mergeCatchUp, runCatchUp } from "./catchup";
import { collectChanges, type ChangeMode } from "./changes";
import type { GmailSyncPort } from "./gmail";
import type { JobContext } from "./jobs";
import { processJobs, type JobCounts } from "./queue";
import { ingestThread, type IngestResult } from "./store";

// Threads ingested side by side. Gmail calls are paced per account in lib/gmail/quota either way.
const THREAD_CONCURRENCY = 4;

export type SyncResult = {
  mode: ChangeMode;
  threads: number;
  created: number;
  newMessages: number;
  classifyQueued: number;
  // A listing still working through its backlog after this pass, null when there is none.
  catchUp: { mode: "initial" | "fallback"; seen: number } | null;
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

// One pass for one account, per TECH-PLAN "Sync pipeline". The history cursor only moves once every
// changed thread is stored, so a failure re-reads the same changes next pass instead of losing them.
// Without a usable cursor, the new cursor is stored first and the listing runs in saved batches.
export async function syncAccount(
  db: Db,
  account: Pick<Account, "id" | "email" | "historyId" | "lastSyncAt" | "catchUp">,
  gmail: GmailSyncPort,
  jobContext: JobContext,
  now = new Date(),
  { catchUpBudget = CATCH_UP_THREADS_PER_PASS } = {},
): Promise<SyncResult> {
  const changes = await collectChanges(gmail, account, now);
  let catchUp = account.catchUp ?? null;
  if (changes.catchUp) {
    catchUp = mergeCatchUp(catchUp, changes.catchUp);
    await db.update(accounts).set({ historyId: changes.cursor, catchUp }).where(eq(accounts.id, account.id));
  }

  const ingested: IngestResult[] = [];
  const ingest = async (ids: string[]) => {
    ingested.push(...(await mapLimit(ids, THREAD_CONCURRENCY, (id) => ingestThread(db, gmail, account, id, now))));
  };
  await ingest(changes.gmailThreadIds);
  await db
    .update(accounts)
    .set({ historyId: changes.cursor, lastSyncAt: now, lastSyncError: null })
    .where(eq(accounts.id, account.id));

  if (catchUp) {
    const save = async (state: CatchUpState | null) => {
      await db.update(accounts).set({ catchUp: state }).where(eq(accounts.id, account.id));
    };
    catchUp = await runCatchUp(catchUp, { gmail, ingest, save }, { budget: catchUpBudget });
  }

  const stored = ingested.flatMap((r) => (r.status === "stored" ? [r] : []));
  return {
    mode: changes.mode,
    threads: ingested.length,
    created: stored.filter((r) => r.created).length,
    newMessages: stored.reduce((n, r) => n + r.newMessages, 0),
    classifyQueued: stored.filter((r) => r.classify).length,
    catchUp: catchUp ? { mode: catchUp.mode, seen: catchUp.seen } : null,
    jobs: await processJobs(account.id, jobContext),
  };
}
