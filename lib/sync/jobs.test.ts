import { describe, expect, it } from "vitest";

import { classifyJob } from "@/lib/classify/classify";

import { MAX_ATTEMPTS, backoffMs, jobHandler, settle } from "./jobs";
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

  it("gives up after the last attempt", () => {
    const { outcome, set } = settle({ attempts: MAX_ATTEMPTS - 1 }, "boom");
    expect(outcome).toBe("failed");
    expect(set).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, error: "boom" });
  });
});
