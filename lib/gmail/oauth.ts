import { OAuth2Client, type Credentials } from "google-auth-library";

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

export function defaultAccountStyle(email: string): { label: string; color: string } {
  const domain = email.split("@")[1] ?? "";
  if (domain === "work1.example") return { label: "work1", color: "#EDE95C" };
  if (domain === "work2.example") return { label: "work2", color: "#C792EA" };
  if (domain === "gmail.com") return { label: "personal", color: "#39FF9E" };
  return { label: domain.split(".")[0] || email, color: "#39FF9E" };
}
