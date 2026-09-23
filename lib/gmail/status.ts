// Stored in accounts.last_sync_error when only a new OAuth consent can fix the account.
// Client-safe, no server imports.
export const REAUTH_MESSAGE = "reconnect required";

export function needsReconnect(lastSyncError: string | null): boolean {
  return lastSyncError === REAUTH_MESSAGE;
}
