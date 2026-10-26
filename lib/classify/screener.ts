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

/** What the sender card sets: a bucket the sender's mail always goes to, or out. */
export type SenderChoice = "inbox" | "news" | "paper_trail" | "receipts" | "out_spam" | "out_not_now";

export const SENDER_CHOICES: readonly SenderChoice[] = ["inbox", "news", "paper_trail", "receipts", "out_spam", "out_not_now"];

// A bucket choice lets the sender in with that default bucket, which every later classification follows.
export function choiceDecision(choice: SenderChoice): { decision: UserDecision; defaultBucket: Bucket | null } {
  if (choice === "out_spam" || choice === "out_not_now") return { decision: choice, defaultBucket: null };
  return { decision: "allowed", defaultBucket: choice };
}

/** The card's current choice for a sender, or null while it has none (undecided, or let in with the AI picking). */
export function currentChoice(decision: ScreenerDecision, defaultBucket: Bucket | null): SenderChoice | null {
  if (decision === "out_spam" || decision === "out_not_now") return decision;
  if (decision === "allowed" && defaultBucket && (SENDER_CHOICES as readonly string[]).includes(defaultBucket)) {
    return defaultBucket as SenderChoice;
  }
  return null;
}

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
 * User screener decision. Allowed releases held triage threads to the model's last choice; with a
 * default bucket, every unarchived thread goes there, out ones included. Out moves every unarchived
 * thread out. Returns the moves so lib/actions can log them for undo.
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
    if (decision === "allowed" && defaultBucket) {
      const current = await tx
        .select(cols)
        .from(threads)
        .where(and(eq(threads.senderId, senderId), eq(threads.archived, false)));
      return moveThreads(tx, senderId, current, () => defaultBucket);
    }
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

/**
 * Senders a bulk let in or keep out decides on: each thread's judged senders, once each, in thread
 * order, with the threads that named them. Same choice as one thread at a time, made for all of
 * them before any decision lands.
 */
export function bulkJudgedSenders(
  rows: { id: string; senderId: string | null; messages: { isInbound: boolean; senderId: string | null }[] }[],
  states: Map<string, SenderState>,
): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const t of rows) {
    const ids = inboundSenderIds(t.messages);
    if (t.senderId && !ids.includes(t.senderId)) ids.unshift(t.senderId);
    for (const id of judgedSenders(ids, states, t.senderId)) targets.set(id, [...(targets.get(id) ?? []), t.id]);
  }
  return targets;
}

/** The judged senders of the Triage threads among threadIds (see bulkJudgedSenders), in one read. */
export async function loadTriageSenders(tx: Pick<Db, "select">, threadIds: string[]) {
  const held = threadIds.length
    ? await tx
        .select({ id: threads.id, senderId: threads.senderId })
        .from(threads)
        .where(and(inArray(threads.id, threadIds), eq(threads.bucket, "triage")))
    : [];
  if (!held.length) return { targets: new Map<string, string[]>(), names: new Map<string, { name: string | null; email: string }>() };

  const rows = await tx
    .select({ threadId: messages.threadId, isInbound: messages.isInbound, senderId: messages.senderId })
    .from(messages)
    .where(inArray(messages.threadId, held.map((t) => t.id)))
    .orderBy(asc(messages.date));
  const byThread = new Map<string, { isInbound: boolean; senderId: string | null }[]>();
  for (const r of rows) byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), r]);

  const ids = new Set<string>();
  for (const t of held) if (t.senderId) ids.add(t.senderId);
  for (const r of rows) if (r.isInbound && r.senderId) ids.add(r.senderId);
  const found = ids.size
    ? await tx
        .select({
          id: senders.id,
          email: senders.email,
          name: senders.displayName,
          decision: senders.screenerDecision,
          decidedBy: senders.decidedBy,
        })
        .from(senders)
        .where(inArray(senders.id, [...ids]))
    : [];

  const order = new Map(threadIds.map((id, i) => [id, i]));
  const sorted = held.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    targets: bulkJudgedSenders(
      sorted.map((t) => ({ id: t.id, senderId: t.senderId, messages: byThread.get(t.id) ?? [] })),
      new Map(found.map((s) => [s.id, { decision: s.decision, decidedBy: s.decidedBy }])),
    ),
    names: new Map(found.map((s) => [s.id, { name: s.name, email: s.email }])),
  };
}
