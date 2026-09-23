import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { actionsLog, corrections, senders, threads, type ScreenerDecision } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

import type { LogPayload } from "./apply";
import { touchesMirror } from "./patch";
import type { ThreadState } from "./types";

const DATE_COLUMNS = new Set<keyof ThreadState>(["seenAt", "snoozedUntil", "deadlineAt", "setAsideAt"]);

// Payloads are JSON, so timestamps come back as strings.
function revive(before: Partial<ThreadState>): Partial<ThreadState> {
  return Object.fromEntries(
    Object.entries(before).map(([k, v]) => [
      k,
      DATE_COLUMNS.has(k as keyof ThreadState) && typeof v === "string" ? new Date(v) : v,
    ]),
  ) as Partial<ThreadState>;
}

/**
 * Reverse every change logged under an undo token. Undoing twice is a no-op.
 * `unsubscribed` is set when the batch sent an unsubscribe request, which stays sent.
 * Corrections written by an undone move are removed: the user took the move
 * back, so it should not teach the classifier.
 */
export async function undoAction(db: Db, token: string): Promise<{ count: number; unsubscribed: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(actionsLog)
      .where(and(eq(actionsLog.batchId, token), isNull(actionsLog.undoneAt)))
      .for("update");

    let count = 0;
    let unsubscribed = false;
    for (const row of rows) {
      const payload = row.payload as LogPayload;
      if (payload.unsubscribe) unsubscribed = true;

      if (payload.sender) {
        const s = payload.sender;
        await tx
          .update(senders)
          .set({
            screenerDecision: s.screenerDecision as ScreenerDecision,
            defaultBucket: s.defaultBucket,
            decidedBy: s.decidedBy as "ai" | "user" | null,
            decidedAt: s.decidedAt ? new Date(s.decidedAt) : null,
          })
          .where(eq(senders.id, s.id));
      }

      if (row.threadId && payload.before) {
        const restore = revive(payload.before);
        const [t] = await tx
          .update(threads)
          .set(restore)
          .where(eq(threads.id, row.threadId))
          .returning({ id: threads.id, accountId: threads.accountId });
        if (t) {
          count++;
          if (touchesMirror(restore)) await enqueueWriteback(tx, t);
        }
      }

      if (row.threadId && payload.correction) {
        await tx
          .delete(corrections)
          .where(
            and(
              eq(corrections.threadId, row.threadId),
              eq(corrections.fromBucket, payload.correction.from),
              eq(corrections.toBucket, payload.correction.to),
              // Same transaction as the log row, so the same now(). Compared in SQL to keep microseconds.
              eq(corrections.createdAt, sql`(select ${actionsLog.createdAt} from ${actionsLog} where ${actionsLog.id} = ${row.id})`),
            ),
          );
      }
    }

    if (rows.length) {
      await tx.update(actionsLog).set({ undoneAt: new Date() }).where(eq(actionsLog.batchId, token));
    }
    return { count, unsubscribed };
  });
}
