import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  classifications,
  messages,
  senders,
  threads,
  type Bucket,
  type ScreenerDecision,
} from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

import { recordCorrection } from "./corrections";
import { isRecordBucket, PROMOTE_URGENCY } from "./thresholds";

export type UserDecision = Exclude<ScreenerDecision, "none">;

export type ThreadMove = { threadId: string; from: Bucket; to: Bucket };

type Latest = { bucket: Bucket; urgency: number | null } | undefined;

// Where a held thread goes once its sender is let in.
export function allowedTarget(defaultBucket: Bucket | null, latest: Latest): Bucket {
  if (defaultBucket) return defaultBucket;
  if (!latest) return "inbox";
  if (isRecordBucket(latest.bucket) && (latest.urgency ?? 0) >= PROMOTE_URGENCY) return "inbox";
  return latest.bucket;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function latestClassifications(tx: Tx, threadIds: string[]) {
  const rows = threadIds.length
    ? await tx
        .select({
          threadId: classifications.threadId,
          bucket: classifications.bucket,
          urgency: classifications.urgency,
        })
        .from(classifications)
        .where(inArray(classifications.threadId, threadIds))
        .orderBy(desc(classifications.createdAt))
    : [];
  const latest = new Map<string, { bucket: Bucket; urgency: number | null }>();
  for (const r of rows) if (!latest.has(r.threadId)) latest.set(r.threadId, r);
  return latest;
}

async function moveThreads(
  tx: Tx,
  senderId: string,
  rows: { id: string; accountId: string; bucket: Bucket }[],
  target: (threadId: string) => Bucket,
) {
  const moves: ThreadMove[] = [];
  for (const t of rows) {
    const to = target(t.id);
    if (to === t.bucket) continue;
    await tx
      .update(threads)
      .set({ bucket: to, bucketSource: "user", bucketConfidence: 1, bucketSuggested: false })
      .where(eq(threads.id, t.id));
    await recordCorrection(tx, { threadId: t.id, senderId, fromBucket: t.bucket, toBucket: to });
    await enqueueWriteback(tx, t);
    moves.push({ threadId: t.id, from: t.bucket, to });
  }
  return moves;
}

/**
 * User screener decision. Allowed releases held triage threads to the sender's default bucket
 * or the model's last choice. Out moves every unarchived thread out. Returns the moves so
 * lib/actions can log them for undo.
 */
export async function decideSender(
  db: Db,
  senderId: string,
  decision: UserDecision,
  defaultBucket: Bucket | null = null,
): Promise<ThreadMove[]> {
  return db.transaction(async (tx) => {
    await tx
      .update(senders)
      .set({
        screenerDecision: decision,
        defaultBucket: decision === "allowed" ? defaultBucket : null,
        decidedBy: "user",
        decidedAt: new Date(),
      })
      .where(eq(senders.id, senderId));

    const cols = { id: threads.id, accountId: threads.accountId, bucket: threads.bucket };
    if (decision === "allowed") {
      const held = await tx
        .select(cols)
        .from(threads)
        .where(and(eq(threads.senderId, senderId), eq(threads.bucket, "triage")));
      const latest = await latestClassifications(tx, held.map((t) => t.id));
      return moveThreads(tx, senderId, held, (id) => allowedTarget(defaultBucket, latest.get(id)));
    }

    const current = await tx
      .select(cols)
      .from(threads)
      .where(and(eq(threads.senderId, senderId), eq(threads.archived, false)));
    return moveThreads(tx, senderId, current, () => "out");
  });
}

// "New sender, allowed by AI, undo?": back to undecided, AI-placed threads back to triage.
export async function undoAiAllow(db: Db, senderId: string): Promise<ThreadMove[]> {
  return db.transaction(async (tx) => {
    const reset = await tx
      .update(senders)
      .set({ screenerDecision: "none", decidedBy: null, decidedAt: null, defaultBucket: null })
      .where(
        and(
          eq(senders.id, senderId),
          eq(senders.screenerDecision, "allowed"),
          eq(senders.decidedBy, "ai"),
        ),
      )
      .returning({ id: senders.id });
    if (reset.length === 0) return [];

    const placed = await tx
      .select({ id: threads.id, accountId: threads.accountId, bucket: threads.bucket })
      .from(threads)
      .where(and(eq(threads.senderId, senderId), eq(threads.bucketSource, "ai")));
    return moveThreads(tx, senderId, placed, () => "triage");
  });
}

export type SenderState = { decision: ScreenerDecision; decidedBy: "ai" | "user" | null };

// Inbound senders of a thread, once each, in message order: the first is the thread's sender.
export function inboundSenderIds(rows: { isInbound: boolean; senderId: string | null }[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.isInbound && r.senderId && !ids.includes(r.senderId)) ids.push(r.senderId);
  return ids;
}

/**
 * Who let in and keep out decide on: every undecided inbound sender of the thread, so a newsletter
 * forwarded to a colleague who answered is judged as a whole. With none undecided, the thread's
 * own sender, as before.
 */
export function judgedSenders(ids: string[], states: Map<string, SenderState>, threadSenderId: string | null): string[] {
  const undecided = ids.filter((id) => (states.get(id)?.decision ?? "none") === "none");
  if (undecided.length) return undecided;
  return threadSenderId ? [threadSenderId] : [];
}

// Senders of the thread the AI let in and the user has not confirmed yet.
export function aiAllowedSenders(ids: string[], states: Map<string, SenderState>): string[] {
  return ids.filter((id) => {
    const s = states.get(id);
    return s?.decision === "allowed" && s.decidedBy === "ai";
  });
}

export type ThreadSenders = {
  threadSenderId: string | null;
  // Oldest first.
  messages: { isInbound: boolean; senderId: string | null }[];
  // Inbound senders in message order.
  ids: string[];
  states: Map<string, SenderState>;
  names: Map<string, { name: string | null; email: string }>;
};

export async function loadThreadSenders(tx: Pick<Db, "select">, threadId: string): Promise<ThreadSenders | null> {
  const [thread] = await tx.select({ senderId: threads.senderId }).from(threads).where(eq(threads.id, threadId));
  if (!thread) return null;
  const rows = await tx
    .select({ isInbound: messages.isInbound, senderId: messages.senderId })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.date));
  const ids = inboundSenderIds(rows);
  if (thread.senderId && !ids.includes(thread.senderId)) ids.unshift(thread.senderId);
  const found = ids.length
    ? await tx
        .select({
          id: senders.id,
          email: senders.email,
          name: senders.displayName,
          decision: senders.screenerDecision,
          decidedBy: senders.decidedBy,
        })
        .from(senders)
        .where(inArray(senders.id, ids))
    : [];
  return {
    threadSenderId: thread.senderId,
    messages: rows,
    ids,
    states: new Map(found.map((s) => [s.id, { decision: s.decision, decidedBy: s.decidedBy }])),
    names: new Map(found.map((s) => [s.id, { name: s.name, email: s.email }])),
  };
}
