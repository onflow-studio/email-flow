import type { gmail_v1 } from "@googleapis/gmail";

import { getGmailClient } from "@/lib/gmail/client";
import { httpStatus } from "@/lib/gmail/errors";
import { gmailLimiter, type GmailLimiter } from "@/lib/gmail/quota";

export type HistoryPage = {
  history: gmail_v1.Schema$History[];
  historyId: string;
  nextPageToken: string | null;
};

export type ThreadLabels = {
  id: string;
  messages: { id: string; labelIds: string[] }[];
};

// The slice of Gmail the sync pass reads. lib/gmail adapts to it; tests mock it.
export interface GmailSyncPort {
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
  // Null when the cursor is too old and Gmail no longer has that history.
  listHistory(startHistoryId: string, pageToken?: string): Promise<HistoryPage | null>;
  listThreadIds(query: string, pageToken?: string): Promise<{ threadIds: string[]; nextPageToken: string | null }>;
  // Null when the thread no longer exists.
  getThreadLabels(gmailThreadId: string): Promise<ThreadLabels | null>;
  // Null when the message no longer exists.
  getMessage(gmailMessageId: string): Promise<gmail_v1.Schema$Message | null>;
}

async function orNull<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (httpStatus(error) === 404) return null;
    throw error;
  }
}

export type GmailSyncClient = Pick<gmail_v1.Gmail, "users">;

// Every call goes through the account's limiter: paced, capped in flight, retried on rate limits.
export function createGmailSyncAdapter(gmail: GmailSyncClient, limiter: GmailLimiter): GmailSyncPort {
  return {
    async getProfile() {
      const { data } = await limiter.run("users.getProfile", () => gmail.users.getProfile({ userId: "me" }));
      if (!data.emailAddress || !data.historyId) throw new Error("Gmail profile incomplete");
      return { emailAddress: data.emailAddress, historyId: data.historyId };
    },
    async listHistory(startHistoryId, pageToken) {
      const res = await orNull(
        limiter.run("history.list", () =>
          gmail.users.history.list({
            userId: "me",
            startHistoryId,
            pageToken,
            maxResults: 500,
            historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
          }),
        ),
      );
      if (!res) return null;
      return {
        history: res.data.history ?? [],
        historyId: res.data.historyId ?? startHistoryId,
        nextPageToken: res.data.nextPageToken ?? null,
      };
    },
    async listThreadIds(query, pageToken) {
      const { data } = await limiter.run("threads.list", () =>
        gmail.users.threads.list({ userId: "me", q: query, pageToken, maxResults: 500, includeSpamTrash: true }),
      );
      return {
        threadIds: (data.threads ?? []).flatMap((t) => (t.id ? [t.id] : [])),
        nextPageToken: data.nextPageToken ?? null,
      };
    },
    async getThreadLabels(gmailThreadId) {
      const res = await orNull(
        limiter.run("threads.get", () => gmail.users.threads.get({ userId: "me", id: gmailThreadId, format: "minimal" })),
      );
      if (!res?.data.id) return null;
      return {
        id: res.data.id,
        messages: (res.data.messages ?? []).flatMap((m) =>
          m.id ? [{ id: m.id, labelIds: m.labelIds ?? [] }] : [],
        ),
      };
    },
    async getMessage(gmailMessageId) {
      const res = await orNull(
        limiter.run("messages.get", () => gmail.users.messages.get({ userId: "me", id: gmailMessageId, format: "full" })),
      );
      return res?.data ?? null;
    },
  };
}

export async function getGmailSyncAdapter(accountId: string): Promise<GmailSyncPort> {
  return createGmailSyncAdapter(await getGmailClient(accountId), gmailLimiter(accountId));
}
