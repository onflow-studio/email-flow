import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// One-off second opinion for threads classified before it existed:
// pnpm confirm [--limit <n>] [--dry-run]
// Asks Jev about every AI suggestion still showing its note and drops the note where Jev picks the
// same bucket with enough confidence. The bucket never changes and Claude is not called again.
// Promoted threads (model bucket differs from the thread's) are skipped. Resumable: a confirmed
// thread is no longer suggested, so stop and rerun any time.

const CONCURRENCY = 5;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

async function main() {
  const { and, desc, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { classifications, threads } = await import("@/lib/db/schema");
  const { jevConfigured } = await import("@/lib/ai/jev");
  const { confirmed, jevConfirmer } = await import("@/lib/classify/confirm");
  const { loadContext } = await import("@/lib/classify/context");
  const { MODEL_BUCKETS } = await import("@/lib/classify/types");
  const { withLock } = await import("@/lib/sync");

  if (!jevConfigured()) throw new Error("JEV_API_KEY is not set");
  const limit = Number(arg("limit")) || Infinity;
  const dryRun = process.argv.includes("--dry-run");

  const pending = await db
    .select({ id: threads.id, bucket: threads.bucket, subject: threads.subject })
    .from(threads)
    .where(
      and(
        eq(threads.bucketSource, "ai"),
        eq(threads.bucketSuggested, true),
        inArray(threads.bucket, [...MODEL_BUCKETS]),
        eq(threads.spam, false),
        eq(threads.trashed, false),
      ),
    )
    .orderBy(desc(threads.lastMessageAt));
  const todo = pending.slice(0, limit);
  console.log(`${pending.length} suggested threads; checking ${todo.length}${dryRun ? " (dry run)" : ""}`);
  if (todo.length === 0) process.exit(0);

  const outcome = await withLock("superfer:confirm", async () => {
    let applied = 0;
    let kept = 0;
    let skipped = 0;
    let failed = 0;
    const queue = [...todo];

    async function check(thread: (typeof todo)[number]) {
      const [latest] = await db
        .select({ bucket: classifications.bucket })
        .from(classifications)
        .where(eq(classifications.threadId, thread.id))
        .orderBy(desc(classifications.createdAt))
        .limit(1);
      const loaded = await loadContext(db, thread.id);
      if (!loaded || latest?.bucket !== thread.bucket) return skipped++;

      const opinion = await jevConfirmer(loaded.ctx);
      const decision = {
        bucket: thread.bucket,
        source: "ai" as const,
        confidence: 0,
        suggested: true,
        promoted: false,
        screener: null,
      };
      if (!confirmed(decision, opinion)) return kept++;

      applied++;
      console.log(`${thread.bucket} ${opinion?.confidence.toFixed(2)} ${thread.subject ?? "(no subject)"}`);
      if (dryRun) return;
      await db
        .update(threads)
        .set({ bucketSuggested: false })
        .where(
          and(
            eq(threads.id, thread.id),
            eq(threads.bucket, thread.bucket),
            eq(threads.bucketSource, "ai"),
            eq(threads.bucketSuggested, true),
          ),
        );
    }

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let thread = queue.shift(); thread; thread = queue.shift()) {
          try {
            await check(thread);
          } catch (error) {
            failed++;
            console.error(`thread ${thread.id} failed`, error);
          }
        }
      }),
    );
    console.log(`confirmed ${applied}, kept as suggestion ${kept}, skipped ${skipped}, failed ${failed}`);
  });
  if (outcome === "busy") console.log("confirm already running elsewhere");
  process.exit(0);
}

main().catch((error) => {
  console.error("confirm failed", error);
  process.exit(1);
});
