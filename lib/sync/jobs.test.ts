import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { classifyJob } from "@/lib/classify/classify";
import { jobs, type Job } from "@/lib/db/schema";
import { GmailRateLimitError } from "@/lib/gmail/errors";

import {
  MAX_ATTEMPTS,
  backoffMs,
  enqueueClassify,
  enqueueSummary,
  isUniqueViolation,
  jobHandler,
  requeue,
  runJob,
  settle,
  type JobContext,
} from "./jobs";
import { writebackJob } from "./writeback";

describe("jobHandler", () => {
  it("routes classify and writeback", () => {
    expect(jobHandler("classify")).toBe(classifyJob);
    expect(jobHandler("writeback")).toBe(writebackJob);
  });

  it("has no backfill handler yet", () => {
    expect(jobHandler("backfill")).toBeUndefined();
  });
});

describe("summary refresh", () => {
  function capture() {
    const values: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          values.push(v);
          return { onConflictDoNothing: async () => undefined };
        },
      }),
    } as unknown as Parameters<typeof enqueueSummary>[0];
    return { db, values };
  }

  it("is a classify job told to refresh the summary only, with a key of its own", async () => {
    const { db, values } = capture();
    const thread = { id: "t1", accountId: "a1" };
    await enqueueClassify(db, thread);
    await enqueueSummary(db, thread);
    expect(values[0]).toMatchObject({ type: "classify", payload: { threadId: "t1" }, dedupeKey: "classify:t1" });
    expect(values[1]).toMatchObject({
      type: "classify",
      payload: { threadId: "t1", summaryOnly: true },
      dedupeKey: "summary:t1",
    });
  });
});

describe("retries", () => {
  it("backs off exponentially from a minute, capped at six hours", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(4)).toBe(480_000);
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
  });

  it("puts a failed job back to pending with a later run time", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const { outcome, set } = settle({ attempts: 0 }, new Error("gmail 503"), now);
    expect(outcome).toBe("retry");
    expect(set).toMatchObject({ status: "pending", attempts: 1, error: "gmail 503", lockedAt: null });
    expect(set.runAfter?.getTime()).toBe(now.getTime() + 60_000);
  });

  it("a Gmail rate limit waits it out without using up an attempt", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const tooMany = Object.assign(new Error("Quota exceeded"), { status: 429 });
    const { outcome, set } = settle({ attempts: MAX_ATTEMPTS - 1 }, tooMany, now);
    expect(outcome).toBe("throttled");
    expect(set).toMatchObject({ status: "pending", attempts: MAX_ATTEMPTS - 1, lockedAt: null });
    expect(set.runAfter?.getTime()).toBe(now.getTime() + 60_000);
    expect(settle({ attempts: 0 }, new GmailRateLimitError(90_000), now).set.runAfter?.getTime()).toBe(
      now.getTime() + 90_000,
    );
  });

  it("gives up after the last attempt", () => {
    const { outcome, set } = settle({ attempts: MAX_ATTEMPTS - 1 }, "boom");
    expect(outcome).toBe("failed");
    expect(set).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, error: "boom" });
  });
});

// Records every update; the first `failures` updates throw the given error.
function fakeDb(failures: unknown[] = []) {
  const sets: Record<string, unknown>[] = [];
  const queue = [...failures];
  const db = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          const failure = queue.shift();
          if (failure) throw failure;
          sets.push(set);
        },
      }),
    }),
  };
  return { db: db as unknown as JobContext["db"], sets };
}

const uniqueViolation = Object.assign(new Error("Failed query: update jobs"), {
  cause: Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }),
});

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    type: "writeback",
    accountId: "a1",
    payload: { threadId: "t1" },
    status: "running",
    priority: 10,
    attempts: 0,
    runAfter: new Date(),
    lockedAt: new Date(),
    dedupeKey: "writeback:t1",
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("dedupe while running", () => {
  it("detects unique violations, wrapped by drizzle or bare", () => {
    expect(isUniqueViolation(uniqueViolation)).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("gmail 503"))).toBe(false);
  });

  it("requeue puts a job back to pending when nothing newer is queued", async () => {
    const { db, sets } = fakeDb();
    expect(await requeue(db, "j1", { status: "pending", lockedAt: null })).toBe("requeued");
    expect(sets).toEqual([{ status: "pending", lockedAt: null }]);
  });

  it("requeue yields to a newer pending job with the same key", async () => {
    const { db, sets } = fakeDb([uniqueViolation]);
    expect(await requeue(db, "j1", { status: "pending", lockedAt: null })).toBe("superseded");
    expect(sets).toEqual([{ status: "done", lockedAt: null, error: "superseded by a newer job" }]);
  });

  it("requeue rethrows anything else", async () => {
    const { db } = fakeDb([new Error("connection reset")]);
    await expect(requeue(db, "j1", { status: "pending", lockedAt: null })).rejects.toThrow("connection reset");
  });

  it("a failed run whose retry collides with a newer job is superseded, not an error", async () => {
    const { db, sets } = fakeDb([uniqueViolation]);
    const gmail = vi.fn(async () => {
      throw new Error("gmail 503");
    });
    const threadRow = { accountId: "a1", gmailThreadId: "g1", bucket: "news", archived: false, trashed: false };
    const ctxDb = Object.assign(db, {
      select: () => ({ from: () => ({ where: async () => [threadRow] }) }),
    }) as unknown as JobContext["db"];
    expect(await runJob(job(), { db: ctxDb, gmail })).toBe("superseded");
    expect(sets.at(-1)).toMatchObject({ status: "done", error: "superseded by a newer job" });
  });

  it("the unique index only covers pending jobs, so one can queue behind a running one", () => {
    const index = getTableConfig(jobs).indexes.find((i) => i.config.name === "jobs_dedupe_key_pending_idx");
    expect(index?.config.unique).toBe(true);
    const where = new PgDialect().sqlToQuery(index!.config.where!).sql;
    expect(where).toBe("status = 'pending'");
  });
});
