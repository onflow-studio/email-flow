import type { gmail_v1 } from "@googleapis/gmail";

import { getGmailClient } from "@/lib/gmail/client";

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

function status(error: unknown): number | undefined {
  const e = error as { status?: number; code?: number | string; response?: { status?: number } };
  return e?.status ?? e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined);
}

async function orNull<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (status(error) === 404) return null;
    throw error;
  }
}

export async function getGmailSyncAdapter(accountId: string): Promise<GmailSyncPort> {
  const gmail = await getGmailClient(accountId);
  return {
    async getProfile() {
      const { data } = await gmail.users.getProfile({ userId: "me" });
      if (!data.emailAddress || !data.historyId) throw new Error("Gmail profile incomplete");
      return { emailAddress: data.emailAddress, historyId: data.historyId };
    },
    async listHistory(startHistoryId, pageToken) {
      const res = await orNull(
        gmail.users.history.list({
          userId: "me",
          startHistoryId,
          pageToken,
          maxResults: 500,
          historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
        }),
      );
      if (!res) return null;
      return {
        history: res.data.history ?? [],
        historyId: res.data.historyId ?? startHistoryId,
        nextPageToken: res.data.nextPageToken ?? null,
      };
    },
    async listThreadIds(query, pageToken) {
      const { data } = await gmail.users.threads.list({
        userId: "me",
        q: query,
        pageToken,
        maxResults: 500,
        includeSpamTrash: true,
      });
      return {
        threadIds: (data.threads ?? []).flatMap((t) => (t.id ? [t.id] : [])),
        nextPageToken: data.nextPageToken ?? null,
      };
    },
    async getThreadLabels(gmailThreadId) {
      const res = await orNull(gmail.users.threads.get({ userId: "me", id: gmailThreadId, format: "minimal" }));
      if (!res?.data.id) return null;
      return {
        id: res.data.id,
        messages: (res.data.messages ?? []).flatMap((m) =>
          m.id ? [{ id: m.id, labelIds: m.labelIds ?? [] }] : [],
        ),
      };
    },
    async getMessage(gmailMessageId) {
      const res = await orNull(gmail.users.messages.get({ userId: "me", id: gmailMessageId, format: "full" }));
      return res?.data ?? null;
    },
  };
}
