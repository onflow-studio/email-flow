import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { jobs, threads } from "@/lib/db/schema";

import type { GmailSyncPort } from "./gmail";
import { httpStatus } from "@/lib/gmail/errors";
import { PRIORITY_BACKFILL } from "./jobs";

// Year-to-date import, newest first. Progress lives in one `backfill` row in `jobs` per account,
// so a stopped run resumes where it left off. Live sync never claims these rows.
// The full-history import is the same walk on its own row, from January 1 back to the oldest thread.

export const BACKFILL_BATCH = 50;

export type BackfillState = {
  // Epoch seconds. `before` is pinned at start so the listing stays stable across resumes.
  after: number;
  before: number;
  // Page being worked through, null for the first page.
  pageToken: string | null;
  // Threads of that page already handled.
  offset: number;
  seen: number;
  imported: number;
  done: boolean;
};

export function startOfYear(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}

export function newBackfillState(now: Date): BackfillState {
  return {
    after: Math.floor(startOfYear(now).getTime() / 1000),
    before: Math.floor(now.getTime() / 1000),
    pageToken: null,
    offset: 0,
    seen: 0,
    imported: 0,
    done: false,
  };
}

// Everything before January 1. From then on belongs to the year-to-date backfill, which classifies all of it.
export function newFullImportState(now: Date): BackfillState {
  return { ...newBackfillState(now), after: 0, before: Math.floor(startOfYear(now).getTime() / 1000) };
}

// Without `after` Gmail lists everything before `before`, newest first: the full import walks backwards.
export function backfillQuery(state: Pick<BackfillState, "after" | "before">): string {
  const after = state.after ? `after:${state.after} ` : "";
  return `${after}before:${state.before} -in:spam -in:trash -in:chats`;
}

export type BackfillStepDeps = {
  gmail: Pick<GmailSyncPort, "listThreadIds">;
  // Gmail thread ids already in our database; live sync keeps those fresh.
  known: (gmailThreadIds: string[]) => Promise<Set<string>>;
  ingest: (gmailThreadIds: string[]) => Promise<void>;
};

// One batch: list the current page, import the next slice of unknown threads, advance.
export async function backfillStep(
  state: BackfillState,
  deps: BackfillStepDeps,
  batchSize = BACKFILL_BATCH,
): Promise<BackfillState> {
  if (state.done) return state;

  let page;
  try {
    page = await deps.gmail.listThreadIds(backfillQuery(state), state.pageToken ?? undefined);
  } catch (error) {
    // Page tokens go stale after a long pause. Relist from the top; known threads are skipped cheaply.
    if (state.pageToken && httpStatus(error) === 400) return { ...state, pageToken: null, offset: 0 };
    throw error;
  }

  const slice = page.threadIds.slice(state.offset, state.offset + batchSize);
  const known = slice.length ? await deps.known(slice) : new Set<string>();
  const fresh = slice.filter((id) => !known.has(id));
  if (fresh.length) await deps.ingest(fresh);

  const offset = state.offset + slice.length;
  const next = { ...state, offset, seen: state.seen + slice.length, imported: state.imported + fresh.length };
  if (offset < page.threadIds.length) return next;
  if (page.nextPageToken) return { ...next, pageToken: page.nextPageToken, offset: 0 };
  return { ...next, done: true };
}

export const FULL_IMPORT_THREADS_PER_RUN = 250;

export type FullImportDeps = BackfillStepDeps & {
  save: (state: BackfillState) => Promise<void>;
};

// Works through the walk until it ends or the budget is spent, saving after every batch, so a stop
// costs at most one batch. Sized to fit one function run; call again with the returned state.
export async function runFullImport(
  state: BackfillState,
  deps: FullImportDeps,
  { budget = FULL_IMPORT_THREADS_PER_RUN, batch = BACKFILL_BATCH } = {},
): Promise<BackfillState> {
  const start = state.seen;
  while (!state.done && state.seen - start < budget) {
    state = await backfillStep(state, deps, Math.min(batch, budget - (state.seen - start)));
    await deps.save(state);
  }
  return state;
}

export function backfillDedupeKey(accountId: string, { full = false } = {}) {
  return `${full ? "backfill-full" : "backfill"}:${accountId}`;
}

// The account's backfill row, started fresh when there is none or `restart` is asked.
// `full` picks the full-history row, kept apart from the year-to-date one.
export async function loadBackfill(
  db: Db,
  accountId: string,
  { now = new Date(), restart = false, full = false } = {},
): Promise<{ jobId: string; state: BackfillState }> {
  const key = backfillDedupeKey(accountId, { full });
  const [latest] = await db
    .select({ id: jobs.id, status: jobs.status, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, "backfill"), eq(jobs.dedupeKey, key)))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  if (latest && latest.status === "pending" && !restart) {
    return { jobId: latest.id, state: latest.payload as BackfillState };
  }
  if (latest && latest.status === "done" && !restart) {
    return { jobId: latest.id, state: { ...(latest.payload as BackfillState), done: true } };
  }
  if (latest?.status === "pending") {
    await db.update(jobs).set({ status: "done", error: "restarted" }).where(eq(jobs.id, latest.id));
  }

  const state = full ? newFullImportState(now) : newBackfillState(now);
  const [row] = await db
    .insert(jobs)
    .values({
      type: "backfill",
      accountId,
      payload: state,
      priority: PRIORITY_BACKFILL,
      dedupeKey: key,
    })
    .returning({ id: jobs.id });
  return { jobId: row.id, state };
}

export async function saveBackfill(db: Db, jobId: string, state: BackfillState) {
  await db
    .update(jobs)
    .set({ payload: state, status: state.done ? "done" : "pending", error: null })
    .where(eq(jobs.id, jobId));
}

export async function knownThreadIds(db: Db, accountId: string, gmailThreadIds: string[]) {
  const rows = await db
    .select({ id: threads.gmailThreadId })
    .from(threads)
    .where(and(eq(threads.accountId, accountId), inArray(threads.gmailThreadId, gmailThreadIds)));
  return new Set(rows.map((r) => r.id));
}
