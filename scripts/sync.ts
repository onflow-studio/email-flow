import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { SYNC_INTERVAL_MS, syncAllAccounts } = await import("@/lib/sync");

  while (true) {
    const started = Date.now();
    try {
      const result = await syncAllAccounts();
      console.log(`${new Date().toISOString()} sync ok, ${result.accounts} accounts`);
    } catch (error) {
      console.error(`${new Date().toISOString()} sync failed`, error);
    }
    const wait = Math.max(0, SYNC_INTERVAL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main();
