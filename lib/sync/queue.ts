import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

import { runJob, type JobContext, type JobOutcome } from "./jobs";

// A running job this old belongs to a crashed pass.
export const STALE_LOCK_MS = 15 * 60_000;
export const JOBS_PER_PASS = 100;
const CLAIM_BATCH = 10;

export async function releaseStaleLocks(db: Db, now = new Date()) {
  await db
    .update(jobs)
    .set({ status: "pending", lockedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(now.getTime() - STALE_LOCK_MS))));
}

// Due jobs for one account, highest priority first. Skip-locked so parallel passes never share one.
export async function claimJobs(db: Db, accountId: string, limit: number, now = new Date()) {
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.accountId, accountId), eq(jobs.status, "pending"), lte(jobs.runAfter, now)))
    .orderBy(desc(jobs.priority), asc(jobs.runAfter))
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(jobs)
    .set({ status: "running", lockedAt: now })
    .where(inArray(jobs.id, due))
    .returning();
  return claimed.sort((a, b) => b.priority - a.priority || a.runAfter.getTime() - b.runAfter.getTime());
}

async function releaseClaimed(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  await db.update(jobs).set({ status: "pending", lockedAt: null }).where(inArray(jobs.id, ids));
}

export type JobCounts = Record<JobOutcome, number>;

// Runs until nothing is due or the budget is spent. Jobs a handler enqueues (classify then
// writeback) run in the same pass.
export async function processJobs(
  accountId: string,
  ctx: JobContext,
  budget = JOBS_PER_PASS,
): Promise<JobCounts> {
  const counts: JobCounts = { done: 0, retry: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  while (seen.size < budget) {
    const batch = await claimJobs(ctx.db, accountId, Math.min(CLAIM_BATCH, budget - seen.size));
    // Skipped jobs (no handler yet) go straight back to pending; don't spin on them.
    const fresh = batch.filter((job) => !seen.has(job.id));
    if (fresh.length === 0) {
      await releaseClaimed(ctx.db, batch.map((job) => job.id));
      break;
    }
    for (const job of batch) {
      if (seen.has(job.id)) {
        await releaseClaimed(ctx.db, [job.id]);
        continue;
      }
      seen.add(job.id);
      counts[await runJob(job, ctx)]++;
    }
  }
  return counts;
}
