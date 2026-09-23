import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { actionsLog, senders, threads, type Bucket } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

import { inboundSenderIds, loadThreadSenders, type SenderState } from "./screener";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ParticipationInput = {
  bucket: Bucket;
  spam: boolean;
  // The thread's first inbound sender, whose decision holds the thread in triage.
  threadSenderId: string | null;
  // Oldest first.
  messages: { isInbound: boolean; senderId: string | null }[];
  states: Map<string, SenderState>;
  // Senders whose AI let-in the user took back; participation does not let them in again.
  reverted: Set<string>;
};

export type ParticipationPlan = { letIn: string[]; release: boolean };

/**
 * Writing in a thread beats the screener. Once the user has a message in it (a reply, a forward),
 * every undecided inbound sender is let in by AI, the thread's first sender included, and a thread
 * held in triage goes to inbox. Senders with a decision keep it; one the user sent back to
 * undecided stays there.
 */
export function participationPlan(input: ParticipationInput): ParticipationPlan {
  const none: ParticipationPlan = { letIn: [], release: false };
  if (input.spam || !input.messages.some((m) => !m.isInbound)) return none;

  const ids = inboundSenderIds(input.messages);
  if (input.threadSenderId && !ids.includes(input.threadSenderId)) ids.unshift(input.threadSenderId);
  const letIn = ids.filter((id) => (input.states.get(id)?.decision ?? "none") === "none" && !input.reverted.has(id));

  const first = input.threadSenderId;
  const firstAllowed = !!first && (letIn.includes(first) || input.states.get(first)?.decision === "allowed");
  return { letIn, release: input.bucket === "triage" && firstAllowed };
}

export type ParticipationResult = ParticipationPlan & { batchId: string };

// Senders whose AI let-in the user undid and has not redone.
async function revertedSenders(tx: Pick<Db, "select">, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await tx
    .select({ id: sql<string>`${actionsLog.payload}->'sender'->>'id'` })
    .from(actionsLog)
    .where(
      and(
        eq(actionsLog.action, "undoAiAllow"),
        isNull(actionsLog.undoneAt),
        inArray(sql`${actionsLog.payload}->'sender'->>'id'`, ids),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** Everything participationPlan needs about one thread, or null when it is gone. */
export async function loadParticipation(tx: Pick<Db, "select">, threadId: string) {
  const [thread] = await tx
    .select({
      id: threads.id,
      accountId: threads.accountId,
      bucket: threads.bucket,
      bucketSource: threads.bucketSource,
      bucketConfidence: threads.bucketConfidence,
      bucketSuggested: threads.bucketSuggested,
      spam: threads.spam,
    })
    .from(threads)
    .where(eq(threads.id, threadId));
  const found = await loadThreadSenders(tx, threadId);
  if (!thread || !found) return null;
  const input: ParticipationInput = {
    bucket: thread.bucket,
    spam: thread.spam,
    threadSenderId: found.threadSenderId,
    messages: found.messages,
    states: found.states,
    reverted: await revertedSenders(tx, found.ids),
  };
  return { thread, found, input };
}

/**
 * Apply participationPlan to one thread. Each sender let in and the move out of triage are logged
 * in actions_log under one batch, like the user's own screener actions, so undoAction reverses them;
 * the move enqueues writeback. Null when there was nothing to do.
 */
export async function applyParticipation(tx: Tx, threadId: string): Promise<ParticipationResult | null> {
  const loaded = await loadParticipation(tx, threadId);
  if (!loaded) return null;
  const { thread, input } = loaded;
  const plan = participationPlan(input);
  if (!plan.letIn.length && !plan.release) return null;

  const batchId = randomUUID();
  if (plan.letIn.length) {
    const prior = await tx
      .select({
        id: senders.id,
        screenerDecision: senders.screenerDecision,
        defaultBucket: senders.defaultBucket,
        decidedBy: senders.decidedBy,
        decidedAt: senders.decidedAt,
      })
      .from(senders)
      .where(and(inArray(senders.id, plan.letIn), eq(senders.screenerDecision, "none")));
    await tx
      .update(senders)
      .set({ screenerDecision: "allowed", decidedBy: "ai", decidedAt: new Date() })
      .where(and(inArray(senders.id, plan.letIn), eq(senders.screenerDecision, "none")));
    for (const s of prior) {
      await tx.insert(actionsLog).values({
        threadId: null,
        batchId,
        action: "participation",
        payload: { sender: { ...s, decidedAt: s.decidedAt?.toISOString() ?? null } },
      });
    }
  }

  if (plan.release) {
    await tx
      .update(threads)
      .set({ bucket: "inbox", bucketSource: "ai", bucketConfidence: 1, bucketSuggested: false })
      .where(eq(threads.id, thread.id));
    await tx.insert(actionsLog).values({
      threadId: thread.id,
      batchId,
      action: "participation",
      payload: {
        before: {
          bucket: thread.bucket,
          bucketSource: thread.bucketSource,
          bucketConfidence: thread.bucketConfidence,
          bucketSuggested: thread.bucketSuggested,
        },
      },
    });
    await enqueueWriteback(tx, thread);
  }

  return { ...plan, batchId };
}
