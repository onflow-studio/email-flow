"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { syncAllAccounts } from "@/lib/sync";

import { accountsOff, ACCOUNTS_OFF_COOKIE } from "./_lib/account-filter";
import { listAccounts } from "./_lib/queries";

/**
 * Refresh button. Runs the same pass as `/api/sync` in-process rather than
 * over HTTP, so the bearer secret never has to be sent anywhere.
 */
export async function refreshSync(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const outcomes = await syncAllAccounts();
    // Reconnects show from the saved account error, with a link to settings.
    const failed = outcomes.filter((o) => o.status === "error").map((o) => o.label);
    if (failed.length) return { ok: false, error: `sync failed for ${failed.join(", ")}, retry` };
    return { ok: true };
  } catch (error) {
    console.error("refresh sync failed", error);
    return { ok: false, error: "sync failed, retry" };
  } finally {
    refresh();
  }
}

/**
 * Header account toggle. Filters every view, count and search; sync keeps
 * running for all accounts. The last account that is on stays on.
 */
export async function toggleAccount(id: string): Promise<void> {
  const all = await listAccounts();
  if (!all.some((a) => a.id === id)) throw new Error("invalid account");
  const off = new Set((await accountsOff()).filter((o) => all.some((a) => a.id === o)));
  if (off.has(id)) off.delete(id);
  else if (all.length - off.size > 1) off.add(id);
  else return;
  (await cookies()).set(ACCOUNTS_OFF_COOKIE, [...off].join(","), {
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    sameSite: "lax",
    httpOnly: true,
  });
  refresh();
}
