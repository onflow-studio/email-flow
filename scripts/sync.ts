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
          console.log(
            `${stamp} ${o.email} ${r.mode}: ${r.threads} threads, ${r.newMessages} new messages, ` +
              `${r.classifyQueued} to classify, jobs ${r.jobs.done} done ${r.jobs.retry} retry ${r.jobs.failed} failed`,
          );
        } else if (o.status === "error") {
          console.error(`${stamp} ${o.email} sync failed: ${o.error}`);
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
