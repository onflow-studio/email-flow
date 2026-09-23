"use server";

import { refresh } from "next/cache";

import { syncAllAccounts } from "@/lib/sync";

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
