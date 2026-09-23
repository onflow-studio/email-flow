import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { eq } from "drizzle-orm";
import type { Credentials, OAuth2Client } from "google-auth-library";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

import { decryptToken, encryptToken } from "./crypto";
import { createOAuthClient } from "./oauth";

export const REAUTH_MESSAGE = "reconnect required";

// Refresh token revoked or expired. Only a new OAuth consent fixes it.
export class ReauthRequiredError extends Error {
  constructor(readonly accountId: string) {
    super(`Account ${accountId} needs to reconnect`);
    this.name = "ReauthRequiredError";
  }
}

// Refresh this early so a sync pass never starts with a token about to die.
const REFRESH_MARGIN_MS = 60_000;

function isInvalidGrant(error: unknown): boolean {
  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant";
}

export function tokenColumns(tokens: Credentials) {
  return {
    ...(tokens.access_token ? { accessTokenEnc: encryptToken(tokens.access_token) } : {}),
    // Google omits the refresh token on refresh and sometimes on reconnect. Keep the stored one.
    ...(tokens.refresh_token ? { refreshTokenEnc: encryptToken(tokens.refresh_token) } : {}),
    ...(tokens.expiry_date ? { tokenExpiresAt: new Date(tokens.expiry_date) } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
  };
}

async function persistTokens(accountId: string, tokens: Credentials) {
  const columns = tokenColumns(tokens);
  if (Object.keys(columns).length === 0) return;
  await db.update(accounts).set(columns).where(eq(accounts.id, accountId));
}

async function markReauthRequired(accountId: string) {
  await db
    .update(accounts)
    .set({ lastSyncError: REAUTH_MESSAGE })
    .where(eq(accounts.id, accountId));
}

// OAuth client for one account, refreshed if near expiry. Later refreshes during use persist too.
export async function getAuthClient(accountId: string): Promise<OAuth2Client> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.refreshTokenEnc) {
    await markReauthRequired(accountId);
    throw new ReauthRequiredError(accountId);
  }

  const auth = createOAuthClient();
  auth.setCredentials({
    access_token: account.accessTokenEnc ? decryptToken(account.accessTokenEnc) : undefined,
    refresh_token: decryptToken(account.refreshTokenEnc),
    expiry_date: account.tokenExpiresAt?.getTime(),
    scope: account.scope ?? undefined,
  });

  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0;
  if (expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    try {
      const { credentials } = await auth.refreshAccessToken();
      await persistTokens(accountId, credentials);
    } catch (error) {
      if (isInvalidGrant(error)) {
        await markReauthRequired(accountId);
        throw new ReauthRequiredError(accountId);
      }
      throw error;
    }
  }

  // Refreshes the library does on its own mid-use.
  auth.on("tokens", (tokens) => {
    persistTokens(accountId, tokens).catch((error) =>
      console.error(`failed to store refreshed tokens for ${accountId}`, error),
    );
  });

  return auth;
}

export async function getGmailClient(accountId: string): Promise<gmail_v1.Gmail> {
  return gmail({ version: "v1", auth: await getAuthClient(accountId) });
}

// Structurally matches GmailLabelsPort in lib/sync/writeback.ts.
export interface GmailLabelsAdapter {
  listLabels(): Promise<{ id: string; name: string }[]>;
  createLabel(name: string): Promise<{ id: string; name: string }>;
  modifyThread(
    gmailThreadId: string,
    change: { addLabelIds: string[]; removeLabelIds: string[] },
  ): Promise<void>;
}

export async function getGmailLabelsAdapter(accountId: string): Promise<GmailLabelsAdapter> {
  const client = await getGmailClient(accountId);
  return {
    async listLabels() {
      const res = await client.users.labels.list({ userId: "me" });
      return (res.data.labels ?? []).flatMap((l) =>
        l.id && l.name ? [{ id: l.id, name: l.name }] : [],
      );
    },
    async createLabel(name) {
      const res = await client.users.labels.create({
        userId: "me",
        requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      if (!res.data.id || !res.data.name) throw new Error(`Gmail did not return label ${name}`);
      return { id: res.data.id, name: res.data.name };
    },
    async modifyThread(gmailThreadId, change) {
      await client.users.threads.modify({
        userId: "me",
        id: gmailThreadId,
        requestBody: change,
      });
    },
  };
}
