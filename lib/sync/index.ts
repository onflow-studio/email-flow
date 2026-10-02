import { asc, eq, isNotNull } from "drizzle-orm";

import { judgeSenders } from "@/lib/classify/machine";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { ReauthRequiredError, getGmailLabelsAdapter, markReauthRequired } from "@/lib/gmail/client";
import { getGmailDraftsAdapter } from "@/lib/gmail/drafts";
import { isInvalidGrant, isRateLimitError } from "@/lib/gmail/errors";

import { syncDrafts } from "./drafts";
import { getGmailSyncAdapter } from "./gmail";
import { releaseStaleLocks } from "./queue";
import { syncAccount, type SyncResult } from "./run";

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type AccountSyncOutcome =
  | { accountId: string; email: string; label: string; status: "ok"; result: SyncResult }
  | { accountId: string; email: string; label: string; status: "busy" | "reauth" | "throttled" | "error"; error?: string };

// Session advisory lock on a reserved connection, so the loop and the API route never run
// the same account at once. Needs a direct (session) connection, not a transaction pooler.
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | "busy"> {
  const conn = await db.$client.reserve();
  try {
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
    const outcome = await withLock(`superfer:sync:${account.id}`, async () => {
      const gmail = await getGmailSyncAdapter(account.id);
      const result = await syncAccount(db, account, gmail, { db, gmail: getGmailLabelsAdapter });
      await syncDrafts(db, await getGmailDraftsAdapter(account.id), account.id);
      return result;
    });
    if (outcome === "busy") return { ...base, status: "busy" };
    return { ...base, status: "ok", result: outcome };
  } catch (error) {
    // getGmailClient already recorded the reconnect message on the account.
    if (error instanceof ReauthRequiredError) return { ...base, status: "reauth" };
    // The token died mid-pass, on a refresh the library did on its own.
    if (isInvalidGrant(error)) {
      await markReauthRequired(account.id);
      return { ...base, status: "reauth" };
    }
    // Gmail asked us to slow down. Progress is saved and the next pass picks up from there, so this
    // is not a failure to show; it also proves the account is reachable, so an old error is stale.
    if (isRateLimitError(error)) {
      await db.update(accounts).set({ lastSyncError: null }).where(eq(accounts.id, account.id));
      return { ...base, status: "throttled" };
    }
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
  // Settles a few senders' machine flag per pass, for grouping. Best effort: sync is done either way.
  try {
    await withLock("superfer:machine", () => judgeSenders(db));
  } catch (error) {
    console.error("machine judge pass failed", error);
  }
  return outcomes;
}
