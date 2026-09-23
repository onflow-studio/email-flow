import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// One-off list summaries for threads imported before summaries existed:
// pnpm summarize [--limit <n>] [--rate <calls/min>] [--account <email>] [--all] [--dry-run]
// Newest first, resumable: a thread with a current summary is skipped, so stop and rerun any time.
// Live threads only (not archived or trashed) unless --all. News and out keep their snippet.
// --rate is Claude calls per minute for this process, default 20, gentle next to the sync loop.

const DEFAULT_RATE = 20;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_PAUSE_MS = 30_000;
// Claude Haiku 4.5 list prices, USD per million tokens, for the estimate only.
const PRICE_IN = 1;
const PRICE_OUT = 5;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Usage = { inputTokens?: number; outputTokens?: number };

async function main() {
  const { and, desc, eq, exists, isNull, lt, notInArray, or } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { accounts, messages, threads } = await import("@/lib/db/schema");
  const { aiRateLimitWaitMs } = await import("@/lib/ai");
  const { summarizeThread } = await import("@/lib/classify/classify");
  const { withLock } = await import("@/lib/sync");

  const limit = Number(arg("limit")) || Infinity;
  const rate = Number(arg("rate")) || DEFAULT_RATE;
  const only = arg("account")?.toLowerCase();
  const all = process.argv.includes("--all");
  const dryRun = process.argv.includes("--dry-run");
  const gapMs = 60_000 / rate;

  const where = and(
    or(isNull(threads.summaryMessageAt), lt(threads.summaryMessageAt, threads.lastMessageAt)),
    notInArray(threads.bucket, ["news", "out"]),
    eq(threads.spam, false),
    all ? undefined : and(eq(threads.archived, false), eq(threads.trashed, false)),
    only ? eq(accounts.email, only) : undefined,
    exists(
      db
        .select({ one: messages.id })
        .from(messages)
        .where(and(eq(messages.threadId, threads.id), eq(messages.isInbound, true))),
    ),
  );
  const pending = await db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(accounts, eq(threads.accountId, accounts.id))
    .where(where)
    .orderBy(desc(threads.lastMessageAt));
  const todo = pending.slice(0, limit);
  console.log(`${pending.length} threads need a summary; doing ${todo.length} at ${rate}/min`);
  if (dryRun || todo.length === 0) process.exit(0);

  const outcome = await withLock("superfer:summarize", async () => {
    const started = Date.now();
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let errors = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    for (let i = 0; i < todo.length; ) {
      const callStart = Date.now();
      try {
        const run = await summarizeThread(db, todo[i].id);
        if (run) {
          const usage = (run.raw as { usage?: Usage }).usage ?? {};
          tokensIn += usage.inputTokens ?? 0;
          tokensOut += usage.outputTokens ?? 0;
          done++;
          console.log(`${i + 1}/${todo.length} ${run.summary ?? "(no summary)"}`);
        } else {
          skipped++;
        }
        errors = 0;
        i++;
      } catch (error) {
        const wait = aiRateLimitWaitMs(error);
        if (wait !== null) {
          console.log(`rate limited by Claude, pausing ${Math.round(wait / 1000)}s then resuming`);
          await sleep(wait);
          continue;
        }
        errors++;
        failed++;
        console.error(`thread ${todo[i].id} failed (${errors}/${MAX_CONSECUTIVE_ERRORS})`, error);
        if (errors >= MAX_CONSECUTIVE_ERRORS) {
          console.error("summarize paused, run again to resume");
          break;
        }
        i++;
        await sleep(ERROR_PAUSE_MS);
      }
      await sleep(Math.max(0, gapMs - (Date.now() - callStart)));
    }

    const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
    const minutes = (Date.now() - started) / 60_000;
    console.log(
      `summarized ${done}, skipped ${skipped}, failed ${failed} in ${minutes.toFixed(1)} min; ` +
        `${tokensIn} in / ${tokensOut} out tokens, about $${cost.toFixed(4)}`,
    );
    const left = pending.length - done - skipped;
    if (done > 0 && left > 0) {
      console.log(
        `rest: ${left} threads, about $${((cost / done) * left).toFixed(2)} and ` +
          `${Math.ceil(left / rate)} min at ${rate}/min`,
      );
    }
  });
  if (outcome === "busy") console.log("summarize already running elsewhere");
  process.exit(0);
}

main().catch((error) => {
  console.error("summarize failed", error);
  process.exit(1);
});
