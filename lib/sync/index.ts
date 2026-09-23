import { asc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { ReauthRequiredError, getGmailLabelsAdapter } from "@/lib/gmail/client";

import { getGmailSyncAdapter } from "./gmail";
import { releaseStaleLocks } from "./queue";
import { syncAccount, type SyncResult } from "./run";

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type AccountSyncOutcome =
  | { accountId: string; email: string; label: string; status: "ok"; result: SyncResult }
  | { accountId: string; email: string; label: string; status: "busy" | "reauth" | "error"; error?: string };

// Session advisory lock on a reserved connection, so the loop and the API route never run
// the same account at once. Needs a direct (session) connection, not a transaction pooler.
async function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T | "busy"> {
  const conn = await db.$client.reserve();
  try {
    const key = `superfer:sync:${accountId}`;
    const [{ locked }] = await conn`select pg_try_advisory_lock(hashtext(${key})) as locked`;
    if (!locked) return "busy";
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(hashtext(${key}))`;
    }
  } finally {
    conn.release();
  }
}

async function syncOne(account: typeof accounts.$inferSelect): Promise<AccountSyncOutcome> {
  const base = { accountId: account.id, email: account.email, label: account.label };
  try {
    const outcome = await withAccountLock(account.id, async () => {
      const gmail = await getGmailSyncAdapter(account.id);
      return syncAccount(db, account, gmail, { db, gmail: getGmailLabelsAdapter });
    });
    if (outcome === "busy") return { ...base, status: "busy" };
    return { ...base, status: "ok", result: outcome };
  } catch (error) {
    // getGmailClient already recorded "reconnect required" on the account.
    if (error instanceof ReauthRequiredError) return { ...base, status: "reauth" };
    const message = error instanceof Error ? error.message : String(error);
    await db.update(accounts).set({ lastSyncError: message }).where(eq(accounts.id, account.id));
    return { ...base, status: "error", error: message };
  }
}

// One pass over every connected account, or just one when an id is given.
export async function syncAllAccounts(accountId?: string): Promise<AccountSyncOutcome[]> {
  await releaseStaleLocks(db);
  const rows = await db
    .select()
    .from(accounts)
    .where(accountId ? eq(accounts.id, accountId) : isNotNull(accounts.refreshTokenEnc))
    .orderBy(asc(accounts.createdAt));
  const outcomes: AccountSyncOutcome[] = [];
  for (const account of rows) outcomes.push(await syncOne(account));
  return outcomes;
}
