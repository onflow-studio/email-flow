import { OAuth2Client } from "google-auth-library";

// Login only proves who is at the keyboard; no mail scopes.
const LOGIN_SCOPES = ["openid", "email", "profile"];

export const LOGIN_CALLBACK_PATH = "/api/auth/login/callback";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** LOGIN_REDIRECT_URI, or the login callback on GOOGLE_REDIRECT_URI's origin. */
export function loginRedirectUri(): string {
  const explicit = process.env.LOGIN_REDIRECT_URI;
  if (explicit) return explicit;
  return new URL(LOGIN_CALLBACK_PATH, env("GOOGLE_REDIRECT_URI")).toString();
}

function client(): OAuth2Client {
  return new OAuth2Client({
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: loginRedirectUri(),
  });
}

export function buildLoginUrl(state: string): string {
  return client().generateAuthUrl({ scope: LOGIN_SCOPES, prompt: "select_account", state });
}

export async function verifyLogin(code: string): Promise<string> {
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error("Google returned no id_token");
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: env("GOOGLE_CLIENT_ID") });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw new Error("Google account email is missing or unverified");
  return payload.email.toLowerCase();
}
