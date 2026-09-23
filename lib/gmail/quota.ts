import { GmailRateLimitError, isRateLimitError, retryAfterMs } from "./errors";

// Quota units per call, from Gmail's usage limits page. The per-user limit is 15,000 units a
// minute and batching does not get around it.
export const GMAIL_UNITS = {
  "users.getProfile": 1,
  "labels.list": 1,
  "labels.create": 5,
  "history.list": 2,
  "messages.list": 5,
  "messages.get": 5,
  "messages.attachments.get": 5,
  "messages.send": 100,
  "threads.list": 10,
  "threads.get": 10,
  "threads.modify": 10,
} as const;

export type GmailMethod = keyof typeof GMAIL_UNITS;

export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
};

export type LimiterOptions = {
  // Sustained spend. 100/s plus the burst is at most 6,500 a minute, under half the per-user limit;
  // the backfill runs on less (scripts/backfill.ts --rate), so both fit with room for the web app.
  unitsPerSecond: number;
  burst: number;
  // Gmail also rejects too many parallel requests per user.
  concurrency: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  clock: Clock;
};

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export const DEFAULT_LIMITS: LimiterOptions = {
  unitsPerSecond: 100,
  burst: 500,
  concurrency: 4,
  maxAttempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  clock: systemClock,
};

// One account's Gmail budget: a pool capping calls in flight, a token bucket pacing quota units,
// and retries with jittered exponential backoff on rate-limit errors. A rate-limit response pauses
// every caller on the account, not just the one that got it.
export class GmailLimiter {
  private readonly o: LimiterOptions;
  private tokens: number;
  private updatedAt: number;
  private blockedUntil = 0;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private turn: Promise<void> = Promise.resolve();

  constructor(options: Partial<LimiterOptions> = {}) {
    this.o = { ...DEFAULT_LIMITS, ...options };
    this.tokens = this.o.burst;
    this.updatedAt = this.o.clock.now();
  }

  async run<T>(method: GmailMethod, call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.acquire();
      try {
        await this.take(GMAIL_UNITS[method]);
        return await call();
      } catch (error) {
        if (!isRateLimitError(error)) throw error;
        const delay = this.backoff(attempt, error);
        this.block(delay);
        if (attempt >= this.o.maxAttempts) throw new GmailRateLimitError(delay, { cause: error });
      } finally {
        this.release();
      }
    }
  }

  backoff(attempt: number, error: unknown): number {
    const ceiling = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** (attempt - 1));
    // Half fixed, half random: never retries at once, and parallel callers spread out.
    const jittered = ceiling / 2 + this.o.clock.random() * (ceiling / 2);
    return Math.max(jittered, retryAfterMs(error, this.o.clock.now()) ?? 0);
  }

  private block(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.o.clock.now() + ms);
    // Restart from an empty bucket so the first minute after a pause is gentle.
    this.tokens = 0;
    this.updatedAt = this.blockedUntil;
  }

  private refill(now: number) {
    if (now <= this.updatedAt) return;
    this.tokens = Math.min(this.o.burst, this.tokens + ((now - this.updatedAt) * this.o.unitsPerSecond) / 1000);
    this.updatedAt = now;
  }

  // First come, first served, so a big call is not starved by a stream of small ones.
  private take(units: number): Promise<void> {
    const need = Math.min(units, this.o.burst);
    const mine = this.turn.then(async () => {
      for (;;) {
        const now = this.o.clock.now();
        this.refill(now);
        // Whole milliseconds: a fractional wait can land a float's width short and never fill the bucket.
        const wait = Math.ceil(
          Math.max(this.blockedUntil - now, this.tokens >= need ? 0 : ((need - this.tokens) / this.o.unitsPerSecond) * 1000),
        );
        if (wait <= 0) {
          this.tokens -= need;
          return;
        }
        await this.o.clock.sleep(wait);
      }
    });
    this.turn = mine.catch(() => {});
    return mine;
  }

  private async acquire() {
    if (this.active < this.o.concurrency) {
      this.active++;
      return;
    }
    // release() hands its slot straight over, so `active` stays put.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}

// Per process. Separate processes (sync loop, backfill, web) each get their own, hence the headroom.
const limiters = new Map<string, GmailLimiter>();
let processLimits: Partial<LimiterOptions> = {};

// For a whole process, before its first Gmail call: the backfill runs on a smaller budget than live sync.
export function setGmailLimits(limits: Partial<LimiterOptions>) {
  processLimits = limits;
  limiters.clear();
}

export function gmailLimiter(accountId: string): GmailLimiter {
  let limiter = limiters.get(accountId);
  if (!limiter) {
    limiter = new GmailLimiter(processLimits);
    limiters.set(accountId, limiter);
  }
  return limiter;
}
