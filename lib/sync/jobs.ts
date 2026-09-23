import { eq } from "drizzle-orm";

import type { Evaluator } from "@/lib/classify/classify";
import { classifyJob } from "@/lib/classify/classify";
import type { Db } from "@/lib/db";
import { jobs, type Job, type JobType } from "@/lib/db/schema";

import { writebackJob, type GmailLabelsPort } from "./writeback";

export const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

export const PRIORITY_LIVE = 10;
export const PRIORITY_BACKFILL = 0;

// Everything a handler may touch, passed in by the runner so handlers stay testable.
export type JobContext = {
  db: Db;
  gmail: (accountId: string) => Promise<GmailLabelsPort>;
  evaluate?: Evaluator;
};

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

// Resolved at call time so handler modules can import enqueueJob without a load-order cycle.
export function jobHandler(type: JobType): JobHandler | undefined {
  switch (type) {
    case "classify":
      return classifyJob;
    case "writeback":
      return writebackJob;
    default:
      return undefined;
  }
}

export function backoffMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

type Enqueue = {
  type: JobType;
  accountId?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  dedupeKey?: string;
  runAfter?: Date;
};

// A pending or running job with the same dedupe key absorbs this one.
export async function enqueueJob(db: Pick<Db, "insert">, job: Enqueue) {
  await db
    .insert(jobs)
    .values({
      type: job.type,
      accountId: job.accountId ?? null,
      payload: job.payload ?? {},
      priority: job.priority ?? PRIORITY_LIVE,
      dedupeKey: job.dedupeKey ?? null,
      runAfter: job.runAfter ?? new Date(),
    })
    .onConflictDoNothing();
}

export function enqueueClassify(
  db: Pick<Db, "insert">,
  thread: { id: string; accountId: string },
  priority = PRIORITY_LIVE,
) {
  return enqueueJob(db, {
    type: "classify",
    accountId: thread.accountId,
    payload: { threadId: thread.id },
    priority,
    dedupeKey: `classify:${thread.id}`,
  });
}

export function enqueueWriteback(db: Pick<Db, "insert">, thread: { id: string; accountId: string }) {
  return enqueueJob(db, {
    type: "writeback",
    accountId: thread.accountId,
    payload: { threadId: thread.id },
    dedupeKey: `writeback:${thread.id}`,
  });
}

export type JobOutcome = "done" | "retry" | "failed" | "skipped" | "superseded";

export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type PendingSet = { status: "pending"; lockedAt: null } & Partial<Pick<Job, "attempts" | "error" | "runAfter">>;

// Put a claimed job back to pending. If a newer job with the same key was queued while this one
// ran, that one wins: handlers read state at run time, so it covers this job's work too.
export async function requeue(db: Pick<Db, "update">, id: string, set: PendingSet): Promise<"requeued" | "superseded"> {
  try {
    await db.update(jobs).set(set).where(eq(jobs.id, id));
    return "requeued";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(jobs)
      .set({ status: "done", lockedAt: null, error: "superseded by a newer job" })
      .where(eq(jobs.id, id));
    return "superseded";
  }
}

// Settle one job the runner has already claimed (status running, locked).
export function settle(job: Pick<Job, "attempts">, error: unknown, now = new Date()) {
  const attempts = job.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);
  if (attempts >= MAX_ATTEMPTS) {
    return { outcome: "failed" as const, set: { status: "failed" as const, attempts, error: message, lockedAt: null } };
  }
  return {
    outcome: "retry" as const,
    set: {
      status: "pending" as const,
      attempts,
      error: message,
      lockedAt: null,
      runAfter: new Date(now.getTime() + backoffMs(attempts)),
    },
  };
}

export async function runJob(job: Job, ctx: JobContext): Promise<JobOutcome> {
  const handler = jobHandler(job.type);
  if (!handler) {
    // No handler yet (backfill lands later): release it untouched.
    const released = await requeue(ctx.db, job.id, { status: "pending", lockedAt: null });
    return released === "requeued" ? "skipped" : "superseded";
  }
  try {
    await handler(job, ctx);
    await ctx.db
      .update(jobs)
      .set({ status: "done", error: null, lockedAt: null })
      .where(eq(jobs.id, job.id));
    return "done";
  } catch (error) {
    const { outcome, set } = settle(job, error);
    if (set.status === "failed") {
      await ctx.db.update(jobs).set(set).where(eq(jobs.id, job.id));
      return outcome;
    }
    return (await requeue(ctx.db, job.id, set)) === "requeued" ? outcome : "superseded";
  }
}
