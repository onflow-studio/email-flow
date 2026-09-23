import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { SYNC_INTERVAL_MS, syncAllAccounts } = await import("@/lib/sync");

  while (true) {
    const started = Date.now();
    try {
      const outcomes = await syncAllAccounts();
      const stamp = new Date().toISOString();
      if (outcomes.length === 0) console.log(`${stamp} sync idle, no accounts connected`);
      for (const o of outcomes) {
        if (o.status === "ok") {
          const r = o.result;
          const catchUp = r.catchUp ? `, ${r.catchUp.mode} catch-up at ${r.catchUp.seen} threads` : "";
          console.log(
            `${stamp} ${o.email} ${r.mode}: ${r.threads} threads, ${r.newMessages} new messages, ` +
              `${r.classifyQueued} to classify, jobs ${r.jobs.done} done ${r.jobs.retry} retry ${r.jobs.failed} failed` +
              `${r.jobs.throttled ? ` ${r.jobs.throttled} throttled` : ""}${catchUp}`,
          );
        } else if (o.status === "error") {
          console.error(`${stamp} ${o.email} sync failed: ${o.error}`);
        } else if (o.status === "throttled") {
          console.log(`${stamp} ${o.email} rate limited by Gmail, progress saved, resuming next pass`);
        } else {
          console.log(`${stamp} ${o.email} ${o.status === "busy" ? "skipped, another sync running" : "reconnect required"}`);
        }
      }
    } catch (error) {
      console.error(`${new Date().toISOString()} sync failed`, error);
    }
    const wait = Math.max(0, SYNC_INTERVAL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main();
