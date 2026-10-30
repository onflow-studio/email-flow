import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { threads, type Bucket, type Job } from "@/lib/db/schema";

import type { JobContext } from "./jobs";
import { projectLabelState } from "./projects";

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
export const STARRED_LABEL = "STARRED";

export type LabelledBucket = "inbox" | "news" | "paper_trail" | "receipts" | "triage";

export const DEFAULT_LABEL_PREFIX = "superfer";

// Gmail label names for our buckets, under GMAIL_LABEL_PREFIX. Changing the prefix on a live
// instance creates a fresh set of labels; the old ones stay in Gmail untouched.
export function bucketLabels(
  prefix = process.env.GMAIL_LABEL_PREFIX?.trim() || DEFAULT_LABEL_PREFIX,
): Record<LabelledBucket, string> {
  return {
    inbox: `${prefix}/inbox`,
    news: `${prefix}/news`,
    paper_trail: `${prefix}/paper-trail`,
    receipts: `${prefix}/receipts`,
    triage: `${prefix}/triage`,
  };
}

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
  for (const [bucket, name] of Object.entries(bucketLabels()) as [LabelledBucket, string][]) {
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

/** The project labels on the account: the thread's own, null outside a project, and all of them. */
export type ProjectLabels = { own: string | null; all: string[] };

const NO_PROJECTS: ProjectLabels = { own: null, all: [] };

export type MirroredState = {
  bucket: Bucket;
  archived: boolean;
  seen: boolean;
  trashed: boolean;
  spam: boolean;
  starred: boolean;
};

// Full mirrored state in one modify: bucket or project label, inbox, read, trash, spam, star.
// A project thread carries its project's label in place of a bucket label, out of the inbox;
// every other project label goes. A star rides along: a starred thread stays where it is.
export function mirrorChange(state: MirroredState, ids: LabelIds, project: ProjectLabels = NO_PROJECTS) {
  const { addLabelIds, removeLabelIds } = project.own
    ? { addLabelIds: [project.own], removeLabelIds: [...Object.values(ids), INBOX_LABEL] }
    : labelChange(state.bucket, state.archived, ids);
  for (const id of project.all) if (id !== project.own) removeLabelIds.push(id);
  const flag = (label: string, on: boolean) => (on ? addLabelIds : removeLabelIds).push(label);
  if (state.trashed || state.spam) {
    const i = addLabelIds.indexOf(INBOX_LABEL);
    if (i >= 0) addLabelIds.splice(i, 1);
    if (!removeLabelIds.includes(INBOX_LABEL)) removeLabelIds.push(INBOX_LABEL);
  }
  flag(UNREAD_LABEL, !state.seen);
  flag(TRASH_LABEL, state.trashed);
  flag(SPAM_LABEL, state.spam);
  flag(STARRED_LABEL, state.starred);
  return { addLabelIds, removeLabelIds };
}

export async function writeThread(
  thread: MirroredState & { accountId: string; gmailThreadId: string },
  gmail: GmailLabelsPort,
  project: ProjectLabels = NO_PROJECTS,
) {
  const ids = await ensureLabels(thread.accountId, gmail);
  try {
    await gmail.modifyThread(thread.gmailThreadId, mirrorChange(thread, ids, project));
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
      starredAt: threads.starredAt,
      projectId: threads.projectId,
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
  const gmail = await ctx.gmail(thread.accountId);
  const project = await projectLabelState(ctx.db, thread.accountId, thread.projectId, gmail);
  await writeThread({ ...thread, seen: thread.seenAt !== null, starred: thread.starredAt !== null }, gmail, project);
}
