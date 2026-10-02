// Google expires refresh tokens issued to an app in Testing mode 7 days after issue. Sync then
// fails until the account is reconnected, so the app warns ahead of time.
// Client-safe, no server imports.

export const DEFAULT_TOKEN_LIFETIME_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long before expiry the warning starts. */
export const EXPIRY_WARNING_MS = DAY_MS;

/** GOOGLE_TOKEN_LIFETIME_DAYS: unset or invalid is the Testing-mode 7, 0 turns warnings off. */
export function tokenLifetimeDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TOKEN_LIFETIME_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_TOKEN_LIFETIME_DAYS;
}

export type AccessExpiry = { state: "expiring" | "expired"; expiresAt: Date };

type TokenClock = { refreshTokenIssuedAt: Date | null; lastSyncAt: Date | null };

/**
 * Whether an account's Gmail access is about to lapse, or has. Null when there is nothing to say:
 * warnings off, issue time unknown, more than a day left, or a sync succeeded after the computed
 * expiry (the token outlived the estimate, so the estimate is wrong, not the token).
 */
export function accessExpiry(account: TokenClock, lifetimeDays: number, now: Date): AccessExpiry | null {
  if (lifetimeDays <= 0 || !account.refreshTokenIssuedAt) return null;
  const expiresAt = new Date(account.refreshTokenIssuedAt.getTime() + lifetimeDays * DAY_MS);
  const left = expiresAt.getTime() - now.getTime();
  if (left > EXPIRY_WARNING_MS) return null;
  if (left > 0) return { state: "expiring", expiresAt };
  if (account.lastSyncAt && account.lastSyncAt > expiresAt) return null;
  return { state: "expired", expiresAt };
}

/** Reads GOOGLE_TOKEN_LIFETIME_DAYS, so call it on the server. */
export function accessExpiryFromEnv(account: TokenClock, now = new Date()): AccessExpiry | null {
  return accessExpiry(account, tokenLifetimeDays(process.env.GOOGLE_TOKEN_LIFETIME_DAYS), now);
}

/** `gmail access expires in 5h`, `... in 20m`, `gmail access expired`. */
export function expiryText(
  expiry: { state: "expiring" | "expired"; expiresAt: string | Date },
  now = new Date(),
): string {
  if (expiry.state === "expired") return "gmail access expired";
  const ms = Math.max(0, new Date(expiry.expiresAt).getTime() - now.getTime());
  if (ms >= HOUR_MS) return `gmail access expires in ${Math.floor(ms / HOUR_MS)}h`;
  return `gmail access expires in ${Math.max(1, Math.floor(ms / 60_000))}m`;
}
