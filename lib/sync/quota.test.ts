import { describe, expect, it, vi } from "vitest";

import { GmailRateLimitError, isRateLimitError, retryAfterMs } from "@/lib/gmail/errors";
import { GmailLimiter, type Clock } from "@/lib/gmail/quota";

import { createGmailSyncAdapter, type GmailSyncClient } from "./gmail";

// The adapter module also builds real clients; keep the database out of it.
vi.mock("@/lib/gmail/client", () => ({ getGmailClient: vi.fn() }));

// Virtual time: sleeping just moves the clock, so backoffs of a minute run instantly.
function fakeClock(random = 0.5) {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => random,
  };
  return { clock, sleeps, now: () => t };
}

function rateLimited(opts: { status?: number; reason?: string; retryAfter?: string; message?: string } = {}) {
  const status = opts.status ?? 429;
  return Object.assign(new Error(opts.message ?? "Quota exceeded for quota metric 'Total Query Cost'"), {
    status,
    response: {
      status,
      headers: new Headers(opts.retryAfter ? { "retry-after": opts.retryAfter } : {}),
      data: { error: { errors: [{ reason: opts.reason ?? "rateLimitExceeded" }] } },
    },
  });
}

describe("isRateLimitError", () => {
  it("covers 429 and Gmail's per-user 403s, not other 403s", () => {
    expect(isRateLimitError(rateLimited())).toBe(true);
    expect(isRateLimitError(rateLimited({ status: 403, reason: "userRateLimitExceeded" }))).toBe(true);
    expect(isRateLimitError(rateLimited({ status: 403, reason: "rateLimitExceeded" }))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error("Insufficient Permission"), { status: 403 }))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds, an HTTP date, or Gmail's 'Retry after' message", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    expect(retryAfterMs(rateLimited({ retryAfter: "7" }), now)).toBe(7_000);
    expect(retryAfterMs(rateLimited({ retryAfter: "Wed, 23 Sep 2026 12:00:30 GMT" }), now)).toBe(30_000);
    expect(
      retryAfterMs(rateLimited({ message: "User-rate limit exceeded.  Retry after 2026-09-23T12:01:00.000Z." }), now),
    ).toBe(60_000);
    expect(retryAfterMs(rateLimited(), now)).toBeNull();
  });
});

describe("GmailLimiter", () => {
  it("paces calls to the unit budget", async () => {
    const { clock, now } = fakeClock();
    const limiter = new GmailLimiter({ unitsPerSecond: 10, burst: 10, clock });
    const call = vi.fn(async () => "ok");
    // threads.get costs 10: the first spends the burst, each next one waits a second for refill.
    for (let i = 0; i < 4; i++) await limiter.run("threads.get", call);
    expect(call).toHaveBeenCalledTimes(4);
    expect(now()).toBe(3_000);
  });

  it("caps calls in flight", async () => {
    const { clock } = fakeClock();
    const limiter = new GmailLimiter({ concurrency: 2, clock });
    let inFlight = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const call = () =>
      new Promise<void>((resolve) => {
        peak = Math.max(peak, ++inFlight);
        gates.push(() => {
          inFlight--;
          resolve();
        });
      });
    const all = Promise.all(Array.from({ length: 5 }, () => limiter.run("messages.get", call)));
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));
      gates.shift()!();
    }
    await all;
    expect(peak).toBe(2);
  });

  it("retries 429s with growing, jittered backoff and then succeeds", async () => {
    const { clock, sleeps } = fakeClock(0.5);
    const limiter = new GmailLimiter({ baseDelayMs: 1_000, clock });
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited({ status: 403, reason: "userRateLimitExceeded" }))
      .mockResolvedValue("ok");
    await expect(limiter.run("messages.get", call)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
    // Half the ceiling fixed plus half times random(0.5): 750 of 1000, then 1500 of 2000.
    expect(sleeps.filter((ms) => ms >= 750)).toEqual([750, 1_500]);
  });

  it("waits at least as long as Retry-After asks", async () => {
    const { clock, now } = fakeClock();
    const limiter = new GmailLimiter({ clock });
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited({ retryAfter: "30" }))
      .mockResolvedValue("ok");
    await limiter.run("messages.get", call);
    expect(now()).toBeGreaterThanOrEqual(30_000);
  });

  it("pauses every caller on the account after one rate-limit response", async () => {
    const { clock } = fakeClock();
    const limiter = new GmailLimiter({ clock });
    const calledAt: number[] = [];
    let first = true;
    const call = async () => {
      calledAt.push(clock.now());
      if (first) {
        first = false;
        throw rateLimited({ retryAfter: "20" });
      }
      return "ok";
    };
    await limiter.run("messages.get", call);
    await limiter.run("messages.get", call);
    expect(calledAt[1]).toBeGreaterThanOrEqual(20_000);
    expect(calledAt[2]).toBeGreaterThanOrEqual(20_000);
  });

  it("gives up with a GmailRateLimitError after the last attempt", async () => {
    const { clock } = fakeClock();
    const limiter = new GmailLimiter({ maxAttempts: 3, clock });
    const call = vi.fn(async () => {
      throw rateLimited();
    });
    await expect(limiter.run("messages.get", call)).rejects.toBeInstanceOf(GmailRateLimitError);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("passes other errors straight through", async () => {
    const { clock } = fakeClock();
    const limiter = new GmailLimiter({ clock });
    const boom = Object.assign(new Error("Not Found"), { status: 404 });
    const call = vi.fn(async () => {
      throw boom;
    });
    await expect(limiter.run("messages.get", call)).rejects.toBe(boom);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("sync adapter under 429s", () => {
  it("fetches through rate limits without losing a message", async () => {
    const { clock } = fakeClock();
    let calls = 0;
    const client = {
      users: {
        messages: {
          get: vi.fn(async ({ id }: { id: string }) => {
            // Every other call is rejected, like a busy account at its per-minute limit.
            if (calls++ % 2 === 0) throw rateLimited();
            return { data: { id, threadId: "t1" } };
          }),
        },
      },
    } as unknown as GmailSyncClient;
    const gmail = createGmailSyncAdapter(client, new GmailLimiter({ clock }));
    const ids = ["m1", "m2", "m3", "m4"];
    const got = await Promise.all(ids.map((id) => gmail.getMessage(id)));
    expect(got.map((m) => m?.id)).toEqual(ids);
  });

  it("still maps a missing message to null", async () => {
    const { clock } = fakeClock();
    const client = {
      users: {
        messages: {
          get: vi.fn(async () => {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }),
        },
      },
    } as unknown as GmailSyncClient;
    const gmail = createGmailSyncAdapter(client, new GmailLimiter({ clock }));
    await expect(gmail.getMessage("gone")).resolves.toBeNull();
  });
});
