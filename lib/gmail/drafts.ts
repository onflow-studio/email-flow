import type { gmail_v1 } from "@googleapis/gmail";

import type { GmailDraftsPort, RemoteDraft } from "@/lib/sync/drafts";

import { getGmailClient } from "./client";
import { httpStatus } from "./errors";
import { gmailLimiter, type GmailLimiter } from "./quota";
import { buildMime, type OutgoingMessage } from "./send";

export type SavedDraft = { gmailDraftId: string; gmailMessageId: string };

/** Creates the Gmail draft, or replaces its message when `gmailDraftId` is given. */
export async function saveGmailDraft(
  accountId: string,
  gmailDraftId: string | null,
  message: OutgoingMessage,
  gmailThreadId?: string,
): Promise<SavedDraft> {
  const gmail = await getGmailClient(accountId);
  const requestBody = { message: gmailThreadId ? { threadId: gmailThreadId } : {} };
  const media = { mimeType: "message/rfc822", body: buildMime(message) };
  const res = await gmailLimiter(accountId).run(gmailDraftId ? "drafts.update" : "drafts.create", () =>
    gmailDraftId
      ? gmail.users.drafts.update({ userId: "me", id: gmailDraftId, requestBody: { id: gmailDraftId, ...requestBody }, media })
      : gmail.users.drafts.create({ userId: "me", requestBody, media }),
  );
  if (!res.data.id || !res.data.message?.id) throw new Error("Gmail did not return the draft");
  return { gmailDraftId: res.data.id, gmailMessageId: res.data.message.id };
}

/** Deletes the Gmail draft. Already gone counts as done. */
export async function deleteGmailDraft(accountId: string, gmailDraftId: string): Promise<void> {
  const gmail = await getGmailClient(accountId);
  try {
    await gmailLimiter(accountId).run("drafts.delete", () => gmail.users.drafts.delete({ userId: "me", id: gmailDraftId }));
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
  }
}

export function createGmailDraftsAdapter(gmail: Pick<gmail_v1.Gmail, "users">, limiter: GmailLimiter): GmailDraftsPort {
  return {
    async listDrafts() {
      const out: RemoteDraft[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await limiter.run("drafts.list", () =>
          gmail.users.drafts.list({ userId: "me", maxResults: 500, pageToken }),
        );
        for (const d of data.drafts ?? []) {
          if (d.id && d.message?.id) out.push({ gmailDraftId: d.id, gmailMessageId: d.message.id });
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async getDraft(gmailDraftId) {
      try {
        const { data } = await limiter.run("drafts.get", () =>
          gmail.users.drafts.get({ userId: "me", id: gmailDraftId, format: "full" }),
        );
        return data.message ?? null;
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
  };
}

export async function getGmailDraftsAdapter(accountId: string): Promise<GmailDraftsPort> {
  return createGmailDraftsAdapter(await getGmailClient(accountId), gmailLimiter(accountId));
}
