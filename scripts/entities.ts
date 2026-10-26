import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Entity extraction over older mail, which the sync cron leaves alone past its 30-day window:
// pnpm entities [--since <yyyy-mm-dd>] [--limit <n>] [--rate <calls/min>] [--account <email>] [--dry-run]
// Newest first, resumable: a thread extraction already read up to its last message is skipped, so stop
// and rerun any time. Same threads as the cron: placed Inbox and Receipts mail from senders not
// screened out. Run --dry-run first: it prints the count and an input token estimate, writes nothing.
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
  const { and, desc, eq, gte, inArray, sql } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { accounts, messages, senders, threads } = await import("@/lib/db/schema");
  const { aiRateLimitWaitMs } = await import("@/lib/ai");
  const { ENTITY_SYSTEM_PROMPT, ENTITY_TEXT_LIMIT } = await import("@/lib/ai/entities");
  const { extractEntities, wantsEntitiesWhere } = await import("@/lib/sync/entities");
  const { withLock } = await import("@/lib/sync");

  const sinceArg = arg("since");
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error(`--since wants yyyy-mm-dd, got ${sinceArg}`);
  const limit = Number(arg("limit")) || Infinity;
  const rate = Number(arg("rate")) || DEFAULT_RATE;
  const only = arg("account")?.toLowerCase();
  const dryRun = process.argv.includes("--dry-run");
  const gapMs = 60_000 / rate;

  const pending = await db
    .select({
      id: threads.id,
      accountId: threads.accountId,
      key: sql<string>`coalesce(${threads.groupId}, ${threads.id})::text`,
    })
    .from(threads)
    .innerJoin(accounts, eq(threads.accountId, accounts.id))
    .leftJoin(senders, eq(senders.id, threads.senderId))
    .where(
      and(
        wantsEntitiesWhere(),
        since ? gte(threads.lastMessageAt, since) : undefined,
        only ? eq(accounts.email, only) : undefined,
      ),
    )
    .orderBy(desc(threads.lastMessageAt));
  // Twin copies are read once, by whichever comes first.
  const keys = new Set<string>();
  const todo = pending
    .filter((t) => {
      if (keys.has(t.key)) return false;
      keys.add(t.key);
      return true;
    })
    .slice(0, limit);
  console.log(`${todo.length} threads need entities${todo.length < pending.length ? ` (of ${pending.length} copies)` : ""} at ${rate}/min`);

  if (dryRun) {
    // Characters / 4: the new messages of each thread, each cut where the call cuts it, plus the prompt.
    let chars = todo.length * ENTITY_SYSTEM_PROMPT.length;
    for (let i = 0; i < todo.length; i += 500) {
      const batch = todo.slice(i, i + 500);
      const [row] = await db
        .select({
          chars: sql<string>`coalesce(sum(least(length(coalesce(${messages.text}, '')), ${ENTITY_TEXT_LIMIT}) + length(coalesce(${messages.subject}, '')) + 200), 0)`,
        })
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.threadId))
        .where(
          and(
            inArray(
              messages.threadId,
              batch.map((t) => t.id),
            ),
            sql`(${threads.entitiesMessageAt} is null or ${messages.date} > ${threads.entitiesMessageAt})`,
          ),
        );
      chars += Number(row.chars);
    }
    const tokens = Math.round(chars / 4);
    console.log(`about ${tokens} input tokens, about $${((tokens * PRICE_IN) / 1e6).toFixed(2)} before output; nothing written`);
    process.exit(0);
  }
  if (todo.length === 0) process.exit(0);

  const started = Date.now();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let stopped = false;

  for (const accountId of [...new Set(todo.map((t) => t.accountId))]) {
    if (stopped) break;
    const mine = todo.filter((t) => t.accountId === accountId);
    const outcome = await withLock(`superfer:entities:${accountId}`, async () => {
      let errors = 0;
      for (let i = 0; i < mine.length; ) {
        const callStart = Date.now();
        try {
          const run = await extractEntities(db, mine[i].id);
          if (run) {
            const usage = (run.raw as { usage?: Usage }).usage ?? {};
            tokensIn += usage.inputTokens ?? 0;
            tokensOut += usage.outputTokens ?? 0;
            done++;
            console.log(
              `${done + skipped}/${todo.length} ${run.entities} entities, ${run.created} new, ${run.links} links` +
                `${run.questions ? `, ${run.questions} questions` : ""}`,
            );
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
          console.error(`thread ${mine[i].id} failed (${errors}/${MAX_CONSECUTIVE_ERRORS})`, error);
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            console.error("entities paused, run again to resume");
            stopped = true;
            break;
          }
          i++;
          await sleep(ERROR_PAUSE_MS);
        }
        await sleep(Math.max(0, gapMs - (Date.now() - callStart)));
      }
    });
    if (outcome === "busy") console.log(`entities already running elsewhere for account ${accountId}, skipped`);
  }

  const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
  const minutes = (Date.now() - started) / 60_000;
  console.log(
    `extracted ${done}, skipped ${skipped}, failed ${failed} in ${minutes.toFixed(1)} min; ` +
      `${tokensIn} in / ${tokensOut} out tokens, about $${cost.toFixed(4)}`,
  );
  const left = todo.length - done - skipped;
  if (done > 0 && left > 0) {
    console.log(
      `rest: ${left} threads, about $${((cost / done) * left).toFixed(2)} and ${Math.ceil(left / rate)} min at ${rate}/min`,
    );
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("entities failed", error);
  process.exit(1);
});
