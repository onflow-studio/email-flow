import { and, count, eq, inArray, ne } from "drizzle-orm";

import { loadTriageSenders } from "@/lib/classify/screener";
import type { Db } from "@/lib/db";
import { accounts, threads } from "@/lib/db/schema";

import { loadStates } from "./apply";
import { patchFor } from "./patch";
import type { ActionPreview, KeepOutPreview, ThreadAction } from "./types";

/**
 * What a bulk action would touch, before it runs. The palette shows this list
 * and its count, then calls applyThreadAction with the same ids.
 */
export async function previewThreadAction(db: Db, threadIds: string[], action: ThreadAction): Promise<ActionPreview> {
  if (!threadIds.length) return { action, threads: [], count: 0 };
  const now = new Date();
  const affected = new Set(
    (await loadStates(db, threadIds)).filter((t) => patchFor(action, t, now)).map((t) => t.id),
  );
  if (!affected.size) return { action, threads: [], count: 0 };

  const rows = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      participants: threads.participantsSummary,
      account: accounts.label,
      lastMessageAt: threads.lastMessageAt,
    })
    .from(threads)
    .innerJoin(accounts, eq(accounts.id, threads.accountId))
    .where(inArray(threads.id, [...affected]));

  const list = rows
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
    .map((r) => ({
      id: r.id,
      subject: r.subject || "(no subject)",
      sender: r.participants || "unknown",
      account: r.account,
      lastMessageAt: r.lastMessageAt.toISOString(),
    }));
  return { action, threads: list, count: list.length };
}

/** How many of the threads each action would change, from one state read. */
export async function countThreadActions(db: Db, threadIds: string[], actions: ThreadAction[]): Promise<number[]> {
  if (!threadIds.length) return actions.map(() => 0);
  const now = new Date();
  const states = await loadStates(db, threadIds);
  return actions.map((action) => states.filter((t) => patchFor(action, t, now)).length);
}

/**
 * Who bulk keep out would decide on among the Triage threads, and how many threads each one's
 * decision moves out (every unarchived thread of theirs, as decideSender does). Execute with
 * applyBulkKeepOut and the same thread ids.
 */
export async function previewBulkKeepOut(db: Db, threadIds: string[], spam: boolean): Promise<KeepOutPreview> {
  const { targets, names } = await loadTriageSenders(db, threadIds);
  if (!targets.size) return { spam, senders: [], threadIds: [], count: 0 };
  const ids = [...targets.keys()];
  const moving = await db
    .select({ senderId: threads.senderId, n: count() })
    .from(threads)
    .where(and(inArray(threads.senderId, ids), eq(threads.archived, false), ne(threads.bucket, "out")))
    .groupBy(threads.senderId);
  const moves = new Map(moving.map((r) => [r.senderId, r.n]));
  const list = ids.map((id) => {
    const n = names.get(id);
    return { id, name: n?.name || n?.email || "unknown", threads: moves.get(id) ?? 0 };
  });
  return { spam, senders: list, threadIds: [...new Set([...targets.values()].flat())], count: list.length };
}

/** How many senders bulk keep out would decide on among the threads. */
export async function countBulkKeepOut(db: Db, threadIds: string[]): Promise<number> {
  return (await loadTriageSenders(db, threadIds)).targets.size;
}
