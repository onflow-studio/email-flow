import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// One-off move of receipts out of Paper Trail, for threads placed before Receipts existed:
// pnpm receipts [--limit <n>] [--rate <calls/min>] [--dry-run]
// Reclassifies Paper Trail threads the user did not place and moves only those the model now calls
// receipts; everything else stays where it is. Threads already in Receipts drop out of the query,
// so stop and rerun any time. The sync loop writes the new labels back to Gmail.
// --rate is Claude calls per minute for this process, default 20, gentle next to the sync loop.

const DEFAULT_RATE = 20;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_PAUSE_MS = 30_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { and, desc, eq, isNull, ne, or } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { threads } = await import("@/lib/db/schema");
  const { aiRateLimitWaitMs } = await import("@/lib/ai");
  const { classifyThread } = await import("@/lib/classify/classify");
  const { withLock } = await import("@/lib/sync");

  const limit = Number(arg("limit")) || Infinity;
  const rate = Number(arg("rate")) || DEFAULT_RATE;
  const dryRun = process.argv.includes("--dry-run");
  const gapMs = 60_000 / rate;

  const pending = await db
    .select({ id: threads.id, subject: threads.subject })
    .from(threads)
    .where(
      and(
        eq(threads.bucket, "paper_trail"),
        or(isNull(threads.bucketSource), ne(threads.bucketSource, "user")),
        eq(threads.spam, false),
        eq(threads.trashed, false),
      ),
    )
    .orderBy(desc(threads.lastMessageAt));
  const todo = pending.slice(0, limit);
  console.log(`${pending.length} paper trail threads to check; doing ${todo.length} at ${rate}/min`);
  if (dryRun || todo.length === 0) process.exit(0);

  const outcome = await withLock("superfer:receipts", async () => {
    let moved = 0;
    let failed = 0;
    let errors = 0;

    for (let i = 0; i < todo.length; ) {
      const callStart = Date.now();
      try {
        const decision = await classifyThread(db, todo[i].id, undefined, { only: "receipts" });
        if (decision?.bucket === "receipts") {
          moved++;
          console.log(`${i + 1}/${todo.length} receipts: ${todo[i].subject ?? "(no subject)"}`);
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
          console.error("receipts paused, run again to resume");
          break;
        }
        i++;
        await sleep(ERROR_PAUSE_MS);
      }
      await sleep(Math.max(0, gapMs - (Date.now() - callStart)));
    }

    console.log(`moved ${moved} to receipts, failed ${failed}, checked ${todo.length}`);
  });
  if (outcome === "busy") console.log("receipts already running elsewhere");
  process.exit(0);
}

main().catch((error) => {
  console.error("receipts failed", error);
  process.exit(1);
});
