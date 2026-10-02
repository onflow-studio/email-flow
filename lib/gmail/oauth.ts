import { OAuth2Client, type Credentials } from "google-auth-library";

import { ACCOUNT_COLORS } from "./colors";

// gmail.modify covers read, labels on messages and threads, archive, trash.
// gmail.labels adds label create and edit, gmail.send covers compose.
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.send",
];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_REDIRECT_URI"),
  });
}

export function buildAuthUrl(state: string, loginHint?: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    // Forces a refresh token on every connect, including reconnects.
    prompt: "consent select_account",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
    login_hint: loginHint,
  });
}

export async function exchangeCode(
  code: string,
): Promise<{ email: string; tokens: Credentials }> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("Google returned no id_token");
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env("GOOGLE_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("Google account email is missing or unverified");
  }
  return { email: payload.email.toLowerCase(), tokens };
}

type AccountStyle = { label: string; color: string };

// Settings caps labels at this length.
const LABEL_MAX = 32;

/**
 * A new account's label and hue until changed in settings. Gmail gets `personal`, any other domain its
 * name. A label already taken falls back to the address's local part, then a numbered one. The hue
 * avoids those already in use while any of DESIGN.md's account hues are left.
 */
export function defaultAccountStyle(email: string, existing: AccountStyle[] = []): AccountStyle {
  const [local = email, domain = ""] = email.split("@");
  const hues = ACCOUNT_COLORS.map((c) => c.hex as string);
  const isGmail = domain === "gmail.com";
  // The same domain always prefers the same work hue.
  const hash = [...domain].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const preferred = isGmail ? hues[0] : hues[1 + (hash % 2)];
  const usedHues = new Set(existing.map((a) => a.color.toUpperCase()));
  const color = [preferred, ...hues].find((hex) => !usedHues.has(hex)) ?? preferred;

  const usedLabels = new Set(existing.map((a) => a.label.toLowerCase()));
  const free = (label: string) => !usedLabels.has(label.toLowerCase());
  const name = local.slice(0, LABEL_MAX);
  let label = [isGmail ? "personal" : (domain.split(".")[0] || name).slice(0, LABEL_MAX), name].find(free);
  for (let n = 2; !label; n++) {
    const suffix = String(n);
    const numbered = name.slice(0, LABEL_MAX - suffix.length) + suffix;
    if (free(numbered)) label = numbered;
  }
  return { label, color };
}
