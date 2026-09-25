import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { threads, type Bucket, type Job } from "@/lib/db/schema";

import type { JobContext } from "./jobs";

// The slice of the Gmail client writeback needs. lib/gmail adapts to it; tests mock it.
export interface GmailLabelsPort {
  listLabels(): Promise<{ id: string; name: string }[]>;
  createLabel(name: string): Promise<{ id: string; name: string }>;
  modifyThread(
    gmailThreadId: string,
    change: { addLabelIds: string[]; removeLabelIds: string[] },
  ): Promise<void>;
}

export const INBOX_LABEL = "INBOX";
export const UNREAD_LABEL = "UNREAD";
export const TRASH_LABEL = "TRASH";
export const SPAM_LABEL = "SPAM";

export type LabelledBucket = "inbox" | "news" | "paper_trail" | "receipts" | "triage";

export const BUCKET_LABELS: Record<LabelledBucket, string> = {
  inbox: "superfer/inbox",
  news: "superfer/news",
  paper_trail: "superfer/paper-trail",
  receipts: "superfer/receipts",
  triage: "superfer/triage",
};

export type LabelIds = Record<LabelledBucket, string>;

// Per process. Label ids never change once created, so a stale entry is impossible short of
// the user deleting the label in Gmail, which surfaces as a failed job and a cache reset.
const labelCache = new Map<string, LabelIds>();

export function clearLabelCache(accountId?: string) {
  if (accountId) labelCache.delete(accountId);
  else labelCache.clear();
}

export async function ensureLabels(accountId: string, gmail: GmailLabelsPort): Promise<LabelIds> {
  const cached = labelCache.get(accountId);
  if (cached) return cached;

  const existing = new Map((await gmail.listLabels()).map((l) => [l.name, l.id]));
  const ids = {} as LabelIds;
  for (const [bucket, name] of Object.entries(BUCKET_LABELS) as [LabelledBucket, string][]) {
    ids[bucket] = existing.get(name) ?? (await gmail.createLabel(name)).id;
  }
  labelCache.set(accountId, ids);
  return ids;
}

// Gmail's inbox mirrors our Inbox bucket. Out gets no bucket label and leaves the inbox.
export function labelChange(bucket: Bucket, archived: boolean, ids: LabelIds) {
  const own = bucket === "out" ? null : ids[bucket];
  const addLabelIds = own ? [own] : [];
  const removeLabelIds = Object.values(ids).filter((id) => id !== own);
  if (bucket === "inbox") {
    if (!archived) addLabelIds.push(INBOX_LABEL);
  } else {
    removeLabelIds.push(INBOX_LABEL);
  }
  return { addLabelIds, removeLabelIds };
}

export async function writeBucket(
  thread: { accountId: string; gmailThreadId: string; bucket: Bucket; archived: boolean },
  gmail: GmailLabelsPort,
) {
  const ids = await ensureLabels(thread.accountId, gmail);
  try {
    await gmail.modifyThread(thread.gmailThreadId, labelChange(thread.bucket, thread.archived, ids));
  } catch (error) {
    clearLabelCache(thread.accountId);
    throw error;
  }
}

export type MirroredState = {
  bucket: Bucket;
  archived: boolean;
  seen: boolean;
  trashed: boolean;
  spam: boolean;
};

// Full mirrored state in one modify: bucket label, inbox, read, trash, spam.
export function mirrorChange(state: MirroredState, ids: LabelIds) {
  const { addLabelIds, removeLabelIds } = labelChange(state.bucket, state.archived, ids);
  const flag = (label: string, on: boolean) => (on ? addLabelIds : removeLabelIds).push(label);
  if (state.trashed || state.spam) {
    const i = addLabelIds.indexOf(INBOX_LABEL);
    if (i >= 0) addLabelIds.splice(i, 1);
    if (!removeLabelIds.includes(INBOX_LABEL)) removeLabelIds.push(INBOX_LABEL);
  }
  flag(UNREAD_LABEL, !state.seen);
  flag(TRASH_LABEL, state.trashed);
  flag(SPAM_LABEL, state.spam);
  return { addLabelIds, removeLabelIds };
}

export async function writeThread(
  thread: MirroredState & { accountId: string; gmailThreadId: string },
  gmail: GmailLabelsPort,
) {
  const ids = await ensureLabels(thread.accountId, gmail);
  try {
    await gmail.modifyThread(thread.gmailThreadId, mirrorChange(thread, ids));
  } catch (error) {
    clearLabelCache(thread.accountId);
    throw error;
  }
}

async function loadThread(db: Db, threadId: string) {
  const [row] = await db
    .select({
      accountId: threads.accountId,
      gmailThreadId: threads.gmailThreadId,
      bucket: threads.bucket,
      archived: threads.archived,
      seenAt: threads.seenAt,
      trashed: threads.trashed,
      spam: threads.spam,
    })
    .from(threads)
    .where(eq(threads.id, threadId));
  return row;
}

// Reads state at run time, so a queued job always writes the latest state.
export async function writebackJob(job: Job, ctx: JobContext) {
  const { threadId } = job.payload as { threadId?: string };
  if (!threadId) throw new Error("writeback job without threadId");
  const thread = await loadThread(ctx.db, threadId);
  if (!thread) return;
  await writeThread({ ...thread, seen: thread.seenAt !== null }, await ctx.gmail(thread.accountId));
}
