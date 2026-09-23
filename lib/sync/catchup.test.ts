import { describe, expect, it, vi } from "vitest";

import type { CatchUpState } from "@/lib/db/schema";
import { GmailRateLimitError } from "@/lib/gmail/errors";
import { GmailLimiter, type Clock } from "@/lib/gmail/quota";

import { catchUpQuery, mergeCatchUp, runCatchUp } from "./catchup";
import { newCatchUp } from "./changes";
import { createGmailSyncAdapter, type GmailSyncClient } from "./gmail";

vi.mock("@/lib/gmail/client", () => ({ getGmailClient: vi.fn() }));

const now = new Date("2026-09-23T12:00:00Z");

// Sleeping just moves the clock, so backoffs run instantly.
function virtualClock(): Clock {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms), random: () => 0 };
}

function tooManyRequests() {
  return Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost'"), {
    status: 429,
    response: { status: 429, headers: new Headers() },
  });
}

// Gmail with two pages of thread ids that answers 429 to the calls listed in `fail` (1-based).
function mockGmail(pages: string[][], fail: number[] = []) {
  let call = 0;
  const list = vi.fn(async ({ pageToken }: { q: string; pageToken?: string }) => {
    call++;
    if (fail.includes(call)) throw tooManyRequests();
    const i = pageToken ? Number(pageToken) : 0;
    if (!pages[i]) throw Object.assign(new Error("Invalid pageToken"), { status: 400 });
    return {
      data: { threads: pages[i].map((id) => ({ id })), nextPageToken: i + 1 < pages.length ? String(i + 1) : undefined },
    };
  });
  const client = { users: { threads: { list } } } as unknown as GmailSyncClient;
  return { list, gmail: createGmailSyncAdapter(client, new GmailLimiter({ clock: virtualClock(), maxAttempts: 3 })) };
}

// An account row's catch_up column, and everything ingested so far.
function store(initial: CatchUpState | null) {
  const saved = { state: initial };
  const ingested: string[] = [];
  return {
    saved,
    ingested,
    save: vi.fn(async (state: CatchUpState | null) => void (saved.state = state)),
    ingest: vi.fn(async (ids: string[]) => void ingested.push(...ids)),
  };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe("catch-up listing", () => {
  it("queries a pinned window", () => {
    const state = newCatchUp("initial", null, now);
    expect(catchUpQuery(state)).toBe(`after:${state.after} before:${state.before}`);
  });

  it("works through every page and clears itself when done", async () => {
    const { gmail } = mockGmail([ids("a", 5), ids("b", 3)]);
    const s = store(newCatchUp("initial", null, now));
    expect(await runCatchUp(s.saved.state!, { gmail, ...s }, { batch: 2 })).toBeNull();
    expect(s.ingested).toEqual([...ids("a", 5), ...ids("b", 3)]);
    expect(s.saved.state).toBeNull();
  });

  it("rides out 429s on the listing itself", async () => {
    const { gmail, list } = mockGmail([ids("a", 3)], [1, 2]);
    const s = store(newCatchUp("initial", null, now));
    expect(await runCatchUp(s.saved.state!, { gmail, ...s })).toBeNull();
    expect(list).toHaveBeenCalledTimes(3);
    expect(s.ingested).toEqual(ids("a", 3));
  });

  it("stops at the pass budget with its place saved, and the next pass carries on", async () => {
    const { gmail } = mockGmail([ids("a", 5), ids("b", 3)]);
    const s = store(newCatchUp("initial", null, now));
    const left = await runCatchUp(s.saved.state!, { gmail, ...s }, { budget: 6, batch: 4 });
    expect(left).toMatchObject({ pageToken: "1", offset: 1, seen: 6 });
    expect(s.saved.state).toEqual(left);
    expect(await runCatchUp(left!, { gmail, ...s }, { budget: 6, batch: 4 })).toBeNull();
    expect(s.ingested).toEqual([...ids("a", 5), ...ids("b", 3)]);
  });

  it("keeps every stored batch when Gmail gives up mid-way, and resumes without redoing them", async () => {
    const { gmail } = mockGmail([ids("a", 10)]);
    const s = store(newCatchUp("initial", null, now));
    let batches = 0;
    const flaky = vi.fn(async (batch: string[]) => {
      if (++batches === 3) throw new GmailRateLimitError(60_000);
      await s.ingest(batch);
    });

    await expect(runCatchUp(s.saved.state!, { gmail, save: s.save, ingest: flaky }, { batch: 3 })).rejects.toBeInstanceOf(
      GmailRateLimitError,
    );
    expect(s.saved.state).toMatchObject({ pageToken: null, offset: 6, seen: 6 });
    expect(s.ingested).toEqual(ids("a", 6));

    expect(await runCatchUp(s.saved.state!, { gmail, ...s }, { batch: 3 })).toBeNull();
    // Each thread exactly once across both passes.
    expect(s.ingested).toEqual(ids("a", 10));
  });

  it("relists from the top when a saved page token has gone stale", async () => {
    const { gmail } = mockGmail([ids("a", 2)]);
    const s = store({ ...newCatchUp("initial", null, now), pageToken: "7", offset: 1 });
    expect(await runCatchUp(s.saved.state!, { gmail, ...s })).toBeNull();
    expect(s.ingested).toEqual(ids("a", 2));
  });

  it("a stale cursor during a first sync widens the window instead of dropping the backlog", () => {
    const initial = { ...newCatchUp("initial", null, now), pageToken: "3", offset: 20, seen: 520 };
    const later = new Date(now.getTime() + 86_400_000);
    const fallback = newCatchUp("fallback", now, later);
    expect(mergeCatchUp(initial, fallback)).toEqual({
      mode: "initial",
      after: initial.after,
      before: fallback.before,
      pageToken: null,
      offset: 0,
      seen: 520,
    });
    expect(mergeCatchUp(null, fallback)).toBe(fallback);
  });
});
