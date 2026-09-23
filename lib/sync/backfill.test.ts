import { describe, expect, it, vi } from "vitest";

import { backfillQuery, backfillStep, newBackfillState, startOfYear, type BackfillState } from "./backfill";

const now = new Date(2026, 8, 23, 12);

function pages(...list: { ids: string[]; next?: string }[]) {
  const byToken = new Map<string | undefined, { ids: string[]; next?: string }>();
  list.forEach((p, i) => byToken.set(i === 0 ? undefined : list[i - 1].next, p));
  return vi.fn(async (_query: string, token?: string) => {
    const page = byToken.get(token);
    if (!page) throw Object.assign(new Error("Invalid pageToken"), { status: 400 });
    return { threadIds: page.ids, nextPageToken: page.next ?? null };
  });
}

function deps(listThreadIds: ReturnType<typeof pages>, knownIds: string[] = []) {
  const ingested: string[] = [];
  return {
    ingested,
    deps: {
      gmail: { listThreadIds },
      known: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => knownIds.includes(id)))),
      ingest: vi.fn(async (ids: string[]) => void ingested.push(...ids)),
    },
  };
}

async function runAll(state: BackfillState, d: ReturnType<typeof deps>["deps"], batch: number) {
  let steps = 0;
  while (!state.done && steps++ < 50) state = await backfillStep(state, d, batch);
  return state;
}

describe("backfill window", () => {
  it("starts January 1 of the current year, local time, and pins the end at start", () => {
    expect(startOfYear(now)).toEqual(new Date(2026, 0, 1));
    const state = newBackfillState(now);
    expect(state).toMatchObject({ pageToken: null, offset: 0, seen: 0, imported: 0, done: false });
    expect(state.after).toBe(new Date(2026, 0, 1).getTime() / 1000);
    expect(state.before).toBe(Math.floor(now.getTime() / 1000));
  });

  it("queries the window without spam, trash or chats", () => {
    expect(backfillQuery({ after: 100, before: 200 })).toBe("after:100 before:200 -in:spam -in:trash -in:chats");
  });
});

describe("backfillStep", () => {
  it("walks pages in batches and finishes after the last page", async () => {
    const list = pages({ ids: ["a", "b", "c"], next: "p2" }, { ids: ["d", "e"] });
    const { deps: d, ingested } = deps(list);
    const done = await runAll(newBackfillState(now), d, 2);
    expect(ingested).toEqual(["a", "b", "c", "d", "e"]);
    expect(done).toMatchObject({ done: true, seen: 5, imported: 5 });
    expect(list).toHaveBeenCalledWith(backfillQuery(newBackfillState(now)), undefined);
    expect(list).toHaveBeenCalledWith(expect.any(String), "p2");
  });

  it("skips threads live sync already stored", async () => {
    const { deps: d, ingested } = deps(pages({ ids: ["a", "b", "c"] }), ["b"]);
    const done = await runAll(newBackfillState(now), d, 10);
    expect(ingested).toEqual(["a", "c"]);
    expect(done).toMatchObject({ seen: 3, imported: 2, done: true });
  });

  it("resumes mid-page from saved progress", async () => {
    const { deps: d, ingested } = deps(pages({ ids: ["a", "b"], next: "p2" }, { ids: ["c", "d", "e"] }));
    const saved = { ...newBackfillState(now), pageToken: "p2", offset: 1, seen: 3, imported: 3 };
    const done = await runAll(saved, d, 10);
    expect(ingested).toEqual(["d", "e"]);
    expect(done).toMatchObject({ seen: 5, imported: 5, done: true });
  });

  it("does not advance when ingest fails, so the batch retries", async () => {
    const { deps: d } = deps(pages({ ids: ["a", "b"] }));
    d.ingest.mockRejectedValueOnce(new Error("gmail 503"));
    const state = newBackfillState(now);
    await expect(backfillStep(state, d, 2)).rejects.toThrow("gmail 503");
    expect(await backfillStep(state, d, 2)).toMatchObject({ offset: 2, imported: 2, done: true });
  });

  it("relists from the top when a saved page token has expired", async () => {
    const { deps: d } = deps(pages({ ids: ["a"] }));
    const stale = { ...newBackfillState(now), pageToken: "expired", offset: 3, seen: 40 };
    expect(await backfillStep(stale, d, 10)).toMatchObject({ pageToken: null, offset: 0, seen: 40 });
  });

  it("does nothing once done", async () => {
    const list = pages({ ids: ["a"] });
    const { deps: d } = deps(list);
    const finished = { ...newBackfillState(now), done: true };
    expect(await backfillStep(finished, d)).toBe(finished);
    expect(list).not.toHaveBeenCalled();
  });
});
