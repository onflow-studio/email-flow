import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "superfer_session";

const DAY_S = 24 * 60 * 60;
// Long enough that the phone install does not log out; renewed on use past halfway.
export const SESSION_MAX_AGE_S = 90 * DAY_S;
const RENEW_AFTER_S = 45 * DAY_S;

/** Off only outside production, so a missing login redirect URI never locks local dev out. */
export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
}

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string): boolean {
  return allowedEmails().includes(email.toLowerCase());
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET is not set or shorter than 32 characters");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export type Session = { email: string; issuedAt: number };

/** `<email base64url>.<issued at, unix s>.<hmac>` */
export function createSessionToken(email: string, now = Date.now()): string {
  const payload = `${Buffer.from(email.toLowerCase()).toString("base64url")}.${Math.floor(now / 1000)}`;
  return `${payload}.${sign(payload)}`;
}

/** Valid signature, not expired, and the email still on the allowlist. */
export function readSessionToken(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [emailPart, issuedPart, mac] = parts;
  const expected = Buffer.from(sign(`${emailPart}.${issuedPart}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const issuedAt = Number(issuedPart);
  const age = now / 1000 - issuedAt;
  if (!Number.isFinite(issuedAt) || age < 0 || age > SESSION_MAX_AGE_S) return null;

  const email = Buffer.from(emailPart, "base64url").toString();
  if (!isAllowed(email)) return null;
  return { email, issuedAt };
}

export function shouldRenew(session: Session, now = Date.now()): boolean {
  return now / 1000 - session.issuedAt > RENEW_AFTER_S;
}

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: secure || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}
