import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { DIGEST_LINE_LIMIT, buildDigestPrompt } from "@/lib/ai/digest";
import type { DigestContent, Job } from "@/lib/db/schema";

import { digestJob, dueDay, enqueueDigest, shapeDigest } from "./digest";
import type { JobContext } from "./jobs";
import { staleCutoffs } from "./stale";

const at = (iso: string) => new Date(iso);

describe("dueDay", () => {
  const utc7 = { hour: 7, timeZone: "UTC" };

  it("is null before the hour and the local date from it on", () => {
    expect(dueDay(at("2026-10-26T06:59:59Z"), utc7)).toBeNull();
    expect(dueDay(at("2026-10-26T07:00:00Z"), utc7)).toBe("2026-10-26");
    expect(dueDay(at("2026-10-26T23:59:59Z"), utc7)).toBe("2026-10-26");
    expect(dueDay(at("2026-10-27T00:00:00Z"), utc7)).toBeNull();
  });

  it("reads the hour and date in the set time zone", () => {
    // Tokyo is already on the 26th at 07:30.
    expect(dueDay(at("2026-10-25T22:30:00Z"), { hour: 7, timeZone: "Asia/Tokyo" })).toBe("2026-10-26");
    // Los Angeles is still on the 25th at 20:00.
    expect(dueDay(at("2026-10-26T03:00:00Z"), { hour: 7, timeZone: "America/Los_Angeles" })).toBe("2026-10-25");
    expect(dueDay(at("2026-10-26T03:00:00Z"), { hour: 21, timeZone: "America/Los_Angeles" })).toBeNull();
  });

  it("follows daylight saving time", () => {
    const madrid = { hour: 7, timeZone: "Europe/Madrid" };
    // Summer time, UTC+2.
    expect(dueDay(at("2026-10-24T04:59:00Z"), madrid)).toBeNull();
    expect(dueDay(at("2026-10-24T05:00:00Z"), madrid)).toBe("2026-10-24");
    // Back to UTC+1 after October 25.
    expect(dueDay(at("2026-10-26T05:59:00Z"), madrid)).toBeNull();
    expect(dueDay(at("2026-10-26T06:00:00Z"), madrid)).toBe("2026-10-26");
    // New York skips 02:00 to 03:00 on March 8; the hour counts as reached.
    const newYork = { hour: 2, timeZone: "America/New_York" };
    expect(dueDay(at("2026-03-08T06:59:00Z"), newYork)).toBeNull();
    expect(dueDay(at("2026-03-08T07:00:00Z"), newYork)).toBe("2026-03-08");
  });

  it("covers midnight", () => {
    expect(dueDay(at("2026-10-26T00:00:00Z"), { hour: 0, timeZone: "UTC" })).toBe("2026-10-26");
  });
});

// A query builder that resolves every chain to `rows`, and records inserts.
function fakeDb(rows: unknown[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "innerJoin", "groupBy", "orderBy", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  const db = {
    select: () => chain,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  return { db: db as unknown as JobContext["db"], inserted };
}

describe("enqueueDigest", () => {
  it("queues one job for the day, keyed by it, on no account", async () => {
    const { db, inserted } = fakeDb([]);
    await enqueueDigest(db, "2026-10-26");
    expect(inserted).toEqual([
      expect.objectContaining({ type: "digest", accountId: null, payload: { day: "2026-10-26" }, dedupeKey: "digest:2026-10-26" }),
    ]);
  });

  it("does nothing once the day has a digest", async () => {
    const { db, inserted } = fakeDb([{ id: "d1" }]);
    await enqueueDigest(db, "2026-10-26");
    expect(inserted).toEqual([]);
  });
});

const now = at("2026-10-26T07:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const row = <T extends object>(id: string, extra: T) => ({ id, subject: `subject ${id}` as string | null, account: "work1", summary: null, ...extra });
const staleThread = { workAt: null, needsReply: false, deadlineAt: null, lastMessageAt: now, bucket: "inbox", createdAt: now, snoozedUntil: null };

describe("shapeDigest", () => {
  const cutoffs = staleCutoffs(now, { workDays: 7, replyDays: 3, triageDays: 3 });
  const shaped = shapeDigest(
    {
      arrivals: [{ bucket: "inbox", n: 3 }, { bucket: "news", n: 9 }, { bucket: "triage", n: 1 }],
      inbox: [row("i1", { subject: null })],
      needsReply: [row("r1", { lastMessageAt: ago(4.5) })],
      needsReplyTotal: 52,
      deadlines: [row("d1", { deadlineAt: ago(1) }), row("d2", { deadlineAt: new Date(now.getTime() + 3600_000) })],
      deadlinesTotal: 2,
      triage: 6,
      stale: [
        { ...staleThread, workAt: ago(8) },
        { ...staleThread, workAt: ago(2) },
        { ...staleThread, needsReply: true, lastMessageAt: ago(4) },
        { ...staleThread, bucket: "triage", createdAt: ago(5) },
        { ...staleThread, bucket: "triage", createdAt: ago(5), snoozedUntil: new Date(now.getTime() + DAY) },
      ],
    },
    now,
    cutoffs,
  );

  it("counts arrivals in every bucket, zero where none came", () => {
    expect(shaped.arrivals).toEqual({ inbox: 3, news: 9, paper_trail: 0, receipts: 0, triage: 1 });
    expect(shaped.since).toBe("2026-10-25T07:00:00.000Z");
    expect(shaped.until).toBe(now.toISOString());
  });

  it("keeps needs-reply age in whole days and the full totals", () => {
    expect(shaped.needsReply).toEqual({
      total: 52,
      items: [{ threadId: "r1", subject: "subject r1", account: "work1", summary: null, lastMessageAt: ago(4.5).toISOString(), days: 4 }],
    });
    expect(shaped.inbox[0].subject).toBe("(no subject)");
  });

  it("marks overdue deadlines", () => {
    expect(shaped.deadlines.items.map((d) => [d.threadId, d.overdue])).toEqual([["d1", true], ["d2", false]]);
  });

  it("counts stale threads by kind, as the digest view does", () => {
    expect(shaped.stale).toEqual({ work: 1, reply: 1, triage: 1 });
    expect(shaped.triage).toBe(6);
  });
});

function content(overrides: Partial<DigestContent> = {}): DigestContent {
  return {
    since: ago(1).toISOString(),
    until: now.toISOString(),
    arrivals: { inbox: 2, news: 5, paper_trail: 1, receipts: 0, triage: 1 },
    inbox: [],
    needsReply: { total: 0, items: [] },
    deadlines: { total: 0, items: [] },
    triage: 3,
    stale: { work: 0, reply: 0, triage: 0 },
    ...overrides,
  };
}

describe("buildDigestPrompt", () => {
  it("sends the counts and at most 40 threads, deadlines first, each once", () => {
    const item = (id: string) => ({ threadId: id, subject: `Thread ${id}`, account: "personal", summary: `about ${id}` });
    const inbox = Array.from({ length: 50 }, (_, i) => item(`i${i}`));
    const { prompt } = buildDigestPrompt(
      content({
        inbox: [item("d1"), ...inbox],
        deadlines: { total: 1, items: [{ ...item("d1"), deadlineAt: now.toISOString(), overdue: false }] },
      }),
    );
    expect(prompt).toContain("inbox 2, news 5, paper trail 1, receipts 0, triage 1");
    expect(prompt).toContain("New senders waiting in Triage: 3.");
    const lines = prompt.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines).toHaveLength(DIGEST_LINE_LIMIT);
    expect(lines[0]).toBe(`- [deadline] Thread d1 (personal, due ${now.toISOString()}) : about d1`);
    expect(lines.filter((l) => l.includes("Thread d1 "))).toHaveLength(1);
  });
});

function mockModel(reply: () => Promise<unknown>) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(await reply()) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 500, noCache: 500, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
      },
      response: { modelId: "claude-sonnet-5" },
      warnings: [],
    }),
  });
}

const digestJobRow = { id: "j1", type: "digest", accountId: null, payload: { day: "2026-10-26" } } as unknown as Job;

describe("digestJob", () => {
  it("gathers, summarizes and stores the day's row", async () => {
    const { db, inserted } = fakeDb([]);
    const model = mockModel(async () => ({ lines: ["Nothing urgent today.", "Two newsletters came in."] }));
    await digestJob(digestJobRow, { db, gmail: async () => { throw new Error("unused"); }, digestModel: model }, now);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      day: "2026-10-26",
      summary: "Nothing urgent today.\nTwo newsletters came in.",
      model: "claude-sonnet-5",
      content: { until: now.toISOString(), triage: 0 },
    });
  });

  it("skips the model when the day already has a digest", async () => {
    const { db, inserted } = fakeDb([{ id: "d1" }]);
    let calls = 0;
    const model = mockModel(async () => {
      calls++;
      return { lines: ["a", "b"] };
    });
    await digestJob(digestJobRow, { db, gmail: async () => { throw new Error("unused"); }, digestModel: model }, now);
    expect(calls).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("throws when the model fails, so the job retries, and stores nothing", async () => {
    const { db, inserted } = fakeDb([]);
    const model = mockModel(async () => {
      throw Object.assign(new Error("overloaded"), { statusCode: 529 });
    });
    await expect(
      digestJob(digestJobRow, { db, gmail: async () => { throw new Error("unused"); }, digestModel: model }, now),
    ).rejects.toThrow("overloaded");
    expect(inserted).toEqual([]);
  });

  it("refuses a payload without a day", async () => {
    const { db } = fakeDb([]);
    await expect(digestJob({ ...digestJobRow, payload: {} }, { db, gmail: async () => { throw new Error("unused"); } }, now)).rejects.toThrow(
      "valid day",
    );
  });
});
