// Stored in accounts.last_sync_error when only a new OAuth consent can fix the account.
// Client-safe, no server imports.
export const REAUTH_MESSAGE = "gmail access expired, reconnect";

// What older versions stored for the same state.
const LEGACY_REAUTH_MESSAGE = "reconnect required";

export function needsReconnect(lastSyncError: string | null): boolean {
  return lastSyncError === REAUTH_MESSAGE || lastSyncError === LEGACY_REAUTH_MESSAGE;
}

/** One click back through Google consent for this address. */
export function reconnectHref(email: string): string {
  return `/api/auth/google/start?hint=${encodeURIComponent(email)}`;
}
