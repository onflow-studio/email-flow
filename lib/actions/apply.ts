import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { recordCorrection } from "@/lib/classify/corrections";
import { decideSender, undoAiAllow, type ThreadMove } from "@/lib/classify/screener";
import type { Db } from "@/lib/db";
import { actionsLog, senders, threads, type Bucket } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

import { before, patchFor, touchesMirror } from "./patch";
import { STATE_COLUMNS, type ActionResult, type SenderAction, type ThreadAction, type ThreadState } from "./types";

/** Undo payload for one actions_log row. */
export type LogPayload = {
  /** Prior values of the thread columns the action changed. */
  before?: Partial<ThreadState>;
  /** Correction written by the move, removed again on undo. */
  correction?: { from: Bucket; to: Bucket };
  /** Prior screener state of the sender, restored on undo. */
  sender?: {
    id: string;
    screenerDecision: string;
    defaultBucket: Bucket | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };
};

const stateColumns = Object.fromEntries(STATE_COLUMNS.map((c) => [c, threads[c]])) as {
  [K in (typeof STATE_COLUMNS)[number]]: (typeof threads)[K];
};

export function loadStates(tx: Pick<Db, "select">, threadIds: string[]) {
  return tx
    .select({ id: threads.id, accountId: threads.accountId, senderId: threads.senderId, ...stateColumns })
    .from(threads)
    .where(inArray(threads.id, threadIds));
}

/**
 * Apply a thread action to one or many threads. Writes local state, logs each
 * change under one batch id (the undo token), writes corrections for moves,
 * and enqueues writeback for anything Gmail mirrors.
 */
export async function applyThreadAction(db: Db, threadIds: string[], action: ThreadAction): Promise<ActionResult> {
  if (!threadIds.length) return { token: null, count: 0 };
  return db.transaction(async (tx) => {
    const batchId = randomUUID();
    const now = new Date();
    let count = 0;

    for (const t of await loadStates(tx, threadIds)) {
      const patch = patchFor(action, t, now);
      if (!patch) continue;
      count++;

      await tx.update(threads).set(patch).where(eq(threads.id, t.id));

      const payload: LogPayload = { before: before(t, patch) };
      if (action.type === "move") {
        await recordCorrection(tx, { threadId: t.id, senderId: t.senderId, fromBucket: t.bucket, toBucket: action.bucket });
        payload.correction = { from: t.bucket, to: action.bucket };
      }
      await tx.insert(actionsLog).values({ threadId: t.id, batchId, action: action.type, payload });
      if (touchesMirror(patch)) await enqueueWriteback(tx, t);
    }

    return { token: count ? batchId : null, count };
  });
}

/**
 * Let in or keep out the sender of a thread through the screener. Logs the
 * sender's prior decision and every thread the screener moved, so one undo
 * reverses all of it.
 */
export async function applySenderAction(db: Db, threadId: string, action: SenderAction): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const [thread] = await tx.select({ senderId: threads.senderId }).from(threads).where(eq(threads.id, threadId));
    const senderId = thread?.senderId;
    if (!senderId) return { token: null, count: 0 };

    const [sender] = await tx
      .select({
        id: senders.id,
        screenerDecision: senders.screenerDecision,
        defaultBucket: senders.defaultBucket,
        decidedBy: senders.decidedBy,
        decidedAt: senders.decidedAt,
      })
      .from(senders)
      .where(eq(senders.id, senderId));
    if (!sender) return { token: null, count: 0 };

    const senderThreads = await tx
      .select({ id: threads.id, ...stateColumns })
      .from(threads)
      .where(eq(threads.senderId, senderId));
    const prior = new Map(senderThreads.map((t) => [t.id, t]));

    // decideSender opens a nested transaction (a savepoint), so everything commits together.
    const screenerDb = tx as unknown as Db;
    let moves: ThreadMove[];
    if (action.type === "letIn") moves = await decideSender(screenerDb, senderId, "allowed");
    else if (action.type === "keepOut") moves = await decideSender(screenerDb, senderId, action.spam ? "out_spam" : "out_not_now");
    else moves = await undoAiAllow(screenerDb, senderId);

    const batchId = randomUUID();
    const senderPayload: LogPayload["sender"] = { ...sender, decidedAt: sender.decidedAt?.toISOString() ?? null };
    await tx.insert(actionsLog).values({ threadId: null, batchId, action: action.type, payload: { sender: senderPayload } });

    for (const m of moves) {
      const t = prior.get(m.threadId);
      if (!t) continue;
      const payload: LogPayload = {
        before: {
          bucket: t.bucket,
          bucketSource: t.bucketSource,
          bucketConfidence: t.bucketConfidence,
          bucketSuggested: t.bucketSuggested,
        },
        correction: { from: m.from, to: m.to },
      };
      await tx.insert(actionsLog).values({ threadId: m.threadId, batchId, action: action.type, payload });
    }

    return { token: batchId, count: moves.length };
  });
}
