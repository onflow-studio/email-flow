import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

// One pass over every account. The per-account pipeline lands in lib/sync/run.ts.
export async function syncAllAccounts() {
  const rows = await db.select({ id: accounts.id }).from(accounts);
  return { accounts: rows.length };
}
