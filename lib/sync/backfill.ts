import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { jobs, threads } from "@/lib/db/schema";

import type { GmailSyncPort } from "./gmail";
import { httpStatus } from "./http";
import { PRIORITY_BACKFILL } from "./jobs";

// Year-to-date import, newest first. Progress lives in one `backfill` row in `jobs` per account,
// so a stopped run resumes where it left off. Live sync never claims these rows.

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

export function backfillQuery(state: Pick<BackfillState, "after" | "before">): string {
  return `after:${state.after} before:${state.before} -in:spam -in:trash -in:chats`;
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

function dedupeKey(accountId: string) {
  return `backfill:${accountId}`;
}

// The account's backfill row, started fresh when there is none or `restart` is asked.
export async function loadBackfill(
  db: Db,
  accountId: string,
  { now = new Date(), restart = false } = {},
): Promise<{ jobId: string; state: BackfillState }> {
  const [latest] = await db
    .select({ id: jobs.id, status: jobs.status, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, "backfill"), eq(jobs.dedupeKey, dedupeKey(accountId))))
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

  const state = newBackfillState(now);
  const [row] = await db
    .insert(jobs)
    .values({
      type: "backfill",
      accountId,
      payload: state,
      priority: PRIORITY_BACKFILL,
      dedupeKey: dedupeKey(accountId),
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
