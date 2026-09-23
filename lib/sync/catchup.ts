import type { CatchUpState } from "@/lib/db/schema";
import { httpStatus } from "@/lib/gmail/errors";

import type { GmailSyncPort } from "./gmail";

// A first sync can be a thousand threads. Each pass takes a slice and saves its place, so a quota
// error or a restart costs at most one batch, and the other accounts get their turn.
export const CATCH_UP_THREADS_PER_PASS = 250;
export const CATCH_UP_BATCH = 25;

export function catchUpQuery(state: Pick<CatchUpState, "after" | "before">): string {
  return `after:${state.after} before:${state.before}`;
}

// A stale cursor while the first sync is still listing: widen to cover both, restart the listing.
export function mergeCatchUp(pending: CatchUpState | null, fresh: CatchUpState): CatchUpState {
  if (!pending) return fresh;
  return {
    ...fresh,
    mode: pending.mode === "initial" ? "initial" : fresh.mode,
    after: Math.min(pending.after, fresh.after),
    seen: pending.seen,
  };
}

export type CatchUpDeps = {
  gmail: Pick<GmailSyncPort, "listThreadIds">;
  ingest: (gmailThreadIds: string[]) => Promise<void>;
  // Null once the listing is done.
  save: (state: CatchUpState | null) => Promise<void>;
};

// Works through the listing until it ends or the budget is spent. Progress is saved after every
// batch, so a throw resumes from the last stored batch next pass. Returns null when done.
export async function runCatchUp(
  state: CatchUpState,
  deps: CatchUpDeps,
  { budget = CATCH_UP_THREADS_PER_PASS, batch = CATCH_UP_BATCH } = {},
): Promise<CatchUpState | null> {
  let spent = 0;
  while (spent < budget) {
    let page;
    try {
      page = await deps.gmail.listThreadIds(catchUpQuery(state), state.pageToken ?? undefined);
    } catch (error) {
      // Page tokens go stale after a long pause. Relist from the top; re-storing a thread is harmless.
      if (state.pageToken && httpStatus(error) === 400) {
        state = { ...state, pageToken: null, offset: 0 };
        await deps.save(state);
        continue;
      }
      throw error;
    }

    while (state.offset < page.threadIds.length && spent < budget) {
      const slice = page.threadIds.slice(state.offset, state.offset + Math.min(batch, budget - spent));
      await deps.ingest(slice);
      spent += slice.length;
      state = { ...state, offset: state.offset + slice.length, seen: state.seen + slice.length };
      await deps.save(state);
    }

    if (state.offset < page.threadIds.length) return state;
    if (!page.nextPageToken) {
      await deps.save(null);
      return null;
    }
    state = { ...state, pageToken: page.nextPageToken, offset: 0 };
    await deps.save(state);
  }
  return state;
}
