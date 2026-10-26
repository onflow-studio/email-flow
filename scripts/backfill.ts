import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Year-to-date import: pnpm backfill [--account <email>] [--restart] [--batch <n>] [--rate <units/s>]
// Resumable: stop any time and run again. Run alongside `pnpm sync`; live mail keeps priority.
// --rate is Gmail quota units per second for this process. The default, 60, is about a quarter of
// the 15,000 per user per minute; live sync spends up to 100, so together they stay under the limit.
//
// Full history: pnpm backfill --full [same options]
// Everything before January 1, walked backwards from there to the oldest thread, on its own job row
// (`backfill-full:<accountId>`), so it never touches the year-to-date one. Messages, threads and
// attachment metadata only. Old threads still in Gmail's inbox are classified, with writeback;
// archived ones keep the bucket from Gmail's categories, no AI call and no labels written to Gmail.
//
// Measure first: pnpm backfill --full --measure [--account <email>]
// Prints counts, sizes and token estimates per account. Reads Gmail, writes nothing.

const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_PAUSE_MS = 30_000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const DEFAULT_RATE = 60;
const MEASURE_SAMPLE = 50;
// The classifier's JSON around subject and text: sender facts, headers, field names.
const CLASSIFY_ENVELOPE_CHARS = 800;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  const { and, asc, eq, isNotNull } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { accounts } = await import("@/lib/db/schema");
  const { ReauthRequiredError, getGmailLabelsAdapter } = await import("@/lib/gmail/client");
  const { GmailRateLimitError, isRateLimitError } = await import("@/lib/gmail/errors");
  const { setGmailLimits } = await import("@/lib/gmail/quota");
  const { withLock } = await import("@/lib/sync");
  const {
    BACKFILL_BATCH,
    backfillQuery,
    backfillStep,
    knownThreadIds,
    loadBackfill,
    newFullImportState,
    runFullImport,
    saveBackfill,
  } = await import("@/lib/sync/backfill");
  const { getGmailSyncAdapter } = await import("@/lib/sync/gmail");
  const { PRIORITY_BACKFILL } = await import("@/lib/sync/jobs");
  const { processJobs } = await import("@/lib/sync/queue");
  const { mapLimit } = await import("@/lib/sync/run");
  const { ingestThread } = await import("@/lib/sync/store");

  const only = arg("account")?.toLowerCase();
  const restart = process.argv.includes("--restart");
  const full = process.argv.includes("--full");
  const measure = process.argv.includes("--measure");
  const batch = Number(arg("batch")) || BACKFILL_BATCH;
  const rate = Number(arg("rate")) || DEFAULT_RATE;
  const mode = full ? "full import" : "backfill";
  if (measure && !full) {
    console.log("--measure needs --full");
    process.exit(1);
  }
  // Two calls in flight and a few seconds of burst: slow and steady, leaving live sync room.
  setGmailLimits({ unitsPerSecond: rate, burst: rate * 5, concurrency: 2 });
  console.log(`${mode} pacing Gmail at ${rate} quota units/s per account`);

  const rows = await db
    .select()
    .from(accounts)
    .where(and(isNotNull(accounts.refreshTokenEnc), only ? eq(accounts.email, only) : undefined))
    .orderBy(asc(accounts.createdAt));
  if (rows.length === 0) {
    console.log(only ? `no connected account ${only}` : "no connected accounts");
    process.exit(0);
  }

  if (measure) {
    const { SYSTEM_PROMPT, TEXT_LIMIT } = await import("@/lib/classify/prompt");
    const { parseGmailMessage } = await import("@/lib/mail/mime");

    for (const account of rows) {
      try {
        const gmail = await getGmailSyncAdapter(account.id);
        const listAll = async (query: string) => {
          const ids: string[] = [];
          let token: string | undefined;
          do {
            const page = await gmail.listThreadIds(query, token);
            ids.push(...page.threadIds);
            token = page.nextPageToken ?? undefined;
          } while (token);
          return ids;
        };

        const profile = await gmail.getProfile();
        const query = backfillQuery(newFullImportState(new Date()));
        const old = await listAll(query);
        const inInbox = await listAll(`${query} in:inbox`);
        let stored = 0;
        for (let i = 0; i < old.length; i += 500) stored += (await knownThreadIds(db, account.id, old.slice(i, i + 500))).size;

        // Threads spread across the whole history, one message each, plus their message counts.
        const step = Math.max(1, Math.floor(old.length / MEASURE_SAMPLE));
        const sample = old.filter((_, i) => i % step === 0).slice(0, MEASURE_SAMPLE);
        let messagesInSample = 0;
        let bytes = 0;
        let chars = 0;
        let fetched = 0;
        for (const id of sample) {
          const thread = await gmail.getThreadLabels(id);
          if (!thread?.messages.length) continue;
          messagesInSample += thread.messages.length;
          const message = await gmail.getMessage(thread.messages[0].id);
          if (!message) continue;
          bytes += message.sizeEstimate ?? 0;
          chars += parseGmailMessage(message).text?.length ?? 0;
          fetched++;
        }
        const threadsSampled = sample.length || 1;
        const avgBytes = fetched ? bytes / fetched : 0;
        const avgChars = fetched ? chars / fetched : 0;
        const oldMessages = old.length * (messagesInSample / threadsSampled);
        const systemTokens = SYSTEM_PROMPT.length / 4;
        const perCall = (Math.min(avgChars, TEXT_LIMIT) + CLASSIFY_ENVELOPE_CHARS) / 4;

        console.log(
          [
            `${account.email}`,
            `  gmail total: ${count(profile.messagesTotal)} messages, ${count(profile.threadsTotal)} threads`,
            `  before January 1: ${count(old.length)} threads, about ${count(oldMessages)} messages`,
            `  of those still in gmail's inbox: ${count(inInbox.length)}`,
            `  of those already stored: ${count(stored)}`,
            `  sample of ${fetched} messages: ${count(avgBytes)} bytes, ${count(avgChars)} text chars on average`,
            `  about ${count((oldMessages * avgBytes) / 1e6)} MB to fetch`,
            `  classify ${count(inInbox.length)} inbox threads: about ${count(inInbox.length * perCall)} input tokens` +
              ` plus ${count(systemTokens)} cacheable system prompt tokens per call`,
            `  embed ${count(oldMessages)} messages: about ${count((oldMessages * avgChars) / 4)} tokens`,
          ].join("\n"),
        );
      } catch (error) {
        if (error instanceof ReauthRequiredError) {
          console.error(`${account.email} reconnect required, skipped`);
          continue;
        }
        throw error;
      }
    }
    process.exit(0);
  }

  for (const account of rows) {
    const lock = full ? `superfer:backfill-full:${account.id}` : `superfer:backfill:${account.id}`;
    const outcome = await withLock(lock, async () => {
      const loaded = await loadBackfill(db, account.id, { restart, full });
      const { jobId } = loaded;
      let { state } = loaded;
      if (state.done) {
        console.log(`${account.email} ${mode} already done, ${state.imported} imported. --restart to run again`);
        return;
      }
      const window = full
        ? `before ${new Date(state.before * 1000).toISOString().slice(0, 10)}`
        : `from ${new Date(state.after * 1000).toISOString().slice(0, 10)}`;
      console.log(`${account.email} ${mode} ${window}, ${state.seen} threads seen so far`);

      const gmail = await getGmailSyncAdapter(account.id);
      const jobContext = { db, gmail: getGmailLabelsAdapter };
      const ingestOptions = full
        ? { classifyPriority: PRIORITY_BACKFILL, classifyArchived: false }
        : { classifyPriority: PRIORITY_BACKFILL };
      const deps = {
        gmail,
        known: (ids: string[]) => knownThreadIds(db, account.id, ids),
        ingest: async (ids: string[]) => {
          await mapLimit(ids, 4, (id) => ingestThread(db, gmail, account, id, new Date(), ingestOptions));
        },
      };
      let errors = 0;

      while (!state.done) {
        try {
          if (full) {
            // One batch per call, so live jobs get their turn between batches.
            state = await runFullImport(state, { ...deps, save: (s) => saveBackfill(db, jobId, s) }, {
              budget: batch,
              batch,
            });
          } else {
            state = await backfillStep(state, deps, batch);
            await saveBackfill(db, jobId, state);
          }
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
            const pause = Math.max(RATE_LIMIT_PAUSE_MS, error instanceof GmailRateLimitError ? error.retryAfterMs : 0);
            console.log(`${account.email} rate limited by Gmail, pausing ${Math.round(pause / 1000)}s then resuming`);
            await sleep(pause);
            continue;
          }
          errors++;
          console.error(`${account.email} ${mode} batch failed (${errors}/${MAX_CONSECUTIVE_ERRORS})`, error);
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`${account.email} ${mode} paused, run again to resume`);
            return;
          }
          await sleep(ERROR_PAUSE_MS);
        }
      }
      console.log(`${account.email} ${mode} done, ${state.imported} threads imported`);
    }).catch((error) => {
      if (error instanceof ReauthRequiredError) {
        console.error(`${account.email} reconnect required, skipped`);
        return;
      }
      throw error;
    });
    if (outcome === "busy") console.log(`${account.email} ${mode} already running elsewhere, skipped`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("backfill failed", error);
  process.exit(1);
});
