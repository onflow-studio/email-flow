import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Year-to-date import: pnpm backfill [--account <email>] [--restart] [--batch <n>]
// Resumable: stop any time and run again. Run alongside `pnpm sync`; live mail keeps priority.

const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_PAUSE_MS = 30_000;
const RATE_LIMIT_PAUSE_MS = 60_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { and, asc, eq, isNotNull } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { accounts } = await import("@/lib/db/schema");
  const { ReauthRequiredError, getGmailLabelsAdapter } = await import("@/lib/gmail/client");
  const { isRateLimitError } = await import("@/lib/gmail/errors");
  const { withLock } = await import("@/lib/sync");
  const { BACKFILL_BATCH, backfillStep, knownThreadIds, loadBackfill, saveBackfill } = await import(
    "@/lib/sync/backfill"
  );
  const { getGmailSyncAdapter } = await import("@/lib/sync/gmail");
  const { PRIORITY_BACKFILL } = await import("@/lib/sync/jobs");
  const { processJobs } = await import("@/lib/sync/queue");
  const { mapLimit } = await import("@/lib/sync/run");
  const { ingestThread } = await import("@/lib/sync/store");

  const only = arg("account")?.toLowerCase();
  const restart = process.argv.includes("--restart");
  const batch = Number(arg("batch")) || BACKFILL_BATCH;

  const rows = await db
    .select()
    .from(accounts)
    .where(and(isNotNull(accounts.refreshTokenEnc), only ? eq(accounts.email, only) : undefined))
    .orderBy(asc(accounts.createdAt));
  if (rows.length === 0) {
    console.log(only ? `no connected account ${only}` : "no connected accounts");
    process.exit(0);
  }

  for (const account of rows) {
    const outcome = await withLock(`superfer:backfill:${account.id}`, async () => {
      const loaded = await loadBackfill(db, account.id, { restart });
      const { jobId } = loaded;
      let { state } = loaded;
      if (state.done) {
        console.log(`${account.email} backfill already done, ${state.imported} imported. --restart to run again`);
        return;
      }
      const since = new Date(state.after * 1000).toISOString().slice(0, 10);
      console.log(`${account.email} backfill from ${since}, ${state.seen} threads seen so far`);

      const gmail = await getGmailSyncAdapter(account.id);
      const jobContext = { db, gmail: getGmailLabelsAdapter };
      let errors = 0;

      while (!state.done) {
        try {
          state = await backfillStep(
            state,
            {
              gmail,
              known: (ids) => knownThreadIds(db, account.id, ids),
              ingest: async (ids) => {
                await mapLimit(ids, 4, (id) =>
                  ingestThread(db, gmail, account, id, new Date(), { classifyPriority: PRIORITY_BACKFILL }),
                );
              },
            },
            batch,
          );
          await saveBackfill(db, jobId, state);
          // Classify as we go. Claims run highest priority first, so live mail still goes first.
          const jobs = await processJobs(account.id, jobContext, batch);
          console.log(
            `${account.email} ${state.seen} seen, ${state.imported} imported, ` +
              `classified ${jobs.done} (${jobs.retry} retry, ${jobs.failed} failed)`,
          );
          errors = 0;
        } catch (error) {
          if (error instanceof ReauthRequiredError) throw error;
          // Progress is saved per batch; wait out the quota minute without counting it as a failure.
          if (isRateLimitError(error)) {
            console.log(`${account.email} rate limited by Gmail, pausing`);
            await sleep(RATE_LIMIT_PAUSE_MS);
            continue;
          }
          errors++;
          console.error(`${account.email} backfill batch failed (${errors}/${MAX_CONSECUTIVE_ERRORS})`, error);
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`${account.email} backfill paused, run again to resume`);
            return;
          }
          await sleep(ERROR_PAUSE_MS);
        }
      }
      console.log(`${account.email} backfill done, ${state.imported} threads imported`);
    }).catch((error) => {
      if (error instanceof ReauthRequiredError) {
        console.error(`${account.email} reconnect required, skipped`);
        return;
      }
      throw error;
    });
    if (outcome === "busy") console.log(`${account.email} backfill already running elsewhere, skipped`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("backfill failed", error);
  process.exit(1);
});
