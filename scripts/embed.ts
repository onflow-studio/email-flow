import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { asc, eq } = await import("drizzle-orm");
  const { embeddingsEnabled } = await import("@/lib/ai");
  const { db } = await import("@/lib/db");
  const { accounts } = await import("@/lib/db/schema");
  const { getGmailLabelsAdapter } = await import("@/lib/gmail/client");
  const { enqueueEmbedBacklog } = await import("@/lib/sync/embed");
  const { withLock } = await import("@/lib/sync");
  const { processJobs } = await import("@/lib/sync/queue");

  if (!embeddingsEnabled()) throw new Error("AI_GATEWAY_API_KEY is required for pnpm embed");
  const accountIndex = process.argv.indexOf("--account");
  const only = accountIndex < 0 ? undefined : process.argv[accountIndex + 1]?.toLowerCase();
  if (accountIndex >= 0 && !only) throw new Error("--account requires an email address");
  const rows = await db.select({ id: accounts.id, email: accounts.email }).from(accounts)
    .where(only ? eq(accounts.email, only) : undefined).orderBy(asc(accounts.createdAt));
  if (rows.length === 0) {
    console.log(only ? `no account ${only}` : "no accounts");
    return;
  }
  for (const account of rows) {
    const outcome = await withLock(`superfer:embed:${account.id}`, async () => {
      let embedded = 0;
      while (true) {
        const queued = await enqueueEmbedBacklog(db, account.id);
        const jobs = await processJobs(account.id, { db, gmail: getGmailLabelsAdapter }, 200);
        embedded += jobs.done;
        console.log(`${account.email}: queued ${queued}, completed ${jobs.done}, retry ${jobs.retry}, failed ${jobs.failed}`);
        if (jobs.done === 0) break;
      }
      console.log(`${account.email}: pass complete, ${embedded} jobs completed`);
    });
    if (outcome === "busy") console.log(`${account.email}: embed already running elsewhere, skipped`);
  }
}

main().catch((error) => {
  console.error("embed failed", error);
  process.exitCode = 1;
});
