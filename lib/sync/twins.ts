import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";

import { before, touchesMirror } from "@/lib/actions/patch";
import { STATE_COLUMNS, type ThreadState } from "@/lib/actions/types";
import type { Db } from "@/lib/db";
import { actionsLog, messages, threads } from "@/lib/db/schema";

import { enqueueWriteback } from "./jobs";

// Twins: the same conversation reached more than one account (to personal and work2, say), so Gmail
// holds it as one thread per account. Threads of different accounts that share a message by
// Message-ID get one group id and act as one thread: one row in every list and count, one merged
// timeline, and every action applies to all copies (Gmail writeback per copy, on its own account).

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

/** Group key of a thread: its group id, or its own id when it has no twin. */
export const groupKey = sql`coalesce(${threads.groupId}, ${threads.id})`;

/** Merging groups keeps the smallest key, so linking is deterministic and idempotent. */
export function mergedGroupId(keys: Iterable<string>): string {
  return [...keys].sort()[0];
}

/** Actions the machine takes; they never say what the user wants. */
const MACHINE_ACTIONS = ["participation", "reconcile"];

export type Copy = ThreadState & { id: string; lastMessageAt: Date };

const live = (c: ThreadState) => !c.archived && !c.trashed && !c.spam;
const snoozed = (c: ThreadState, now: Date) => c.snoozedUntil !== null && c.snoozedUntil > now;

/**
 * The copy a list shows when copies disagree: never hide mail. Live before archived or trashed, then
 * not snoozed, pinned, unseen, newest, id. SQL twin of this order: `showOrder`.
 */
export function compareCopies(a: Copy, b: Copy, now = new Date()): number {
  const rank = (c: Copy) => [live(c) ? 0 : 1, snoozed(c, now) ? 1 : 0, c.pinnedAt ? 0 : 1, c.seenAt ? 1 : 0];
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return b.lastMessageAt.getTime() - a.lastMessageAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** `compareCopies` as an ORDER BY over a `threads` alias. */
export function showOrder(t: string): SQL {
  const c = (col: string) => sql.raw(`${t}.${col}`);
  return sql`(${c("archived")} or ${c("trashed")} or ${c("spam")}), coalesce(${c("snoozed_until")} > now(), false), ${c("pinned_at")} is null, ${c("seen_at")} is not null, ${c("last_message_at")} desc, ${c("id")}`;
}

/**
 * Ids of the copies lists show: one per group, chosen among the accounts that are on (null for all),
 * so a group shows while any of its accounts is on. Threads without a twin pass straight through.
 */
export function shownCopy(on: string[] | null): SQL {
  const accounts = on ? sql`and t.account_id in (${sql.join(on.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  return sql`(${threads.groupId} is null or ${threads.id} in (select distinct on (t.group_id) t.id from ${threads} t where t.group_id is not null ${accounts} order by t.group_id, ${showOrder("t")}))`;
}

/** The copy whose state the others take: the one the user acted on last, or none. */
export function sourceCopy(actions: { threadId: string | null }[], members: string[]): string | null {
  return actions.find((a) => a.threadId && members.includes(a.threadId))?.threadId ?? null;
}

/** What a copy changes to match the source; null when it already does. */
export function reconcilePatch(source: ThreadState, copy: ThreadState): Partial<ThreadState> | null {
  const patch: Partial<ThreadState> = {};
  for (const k of STATE_COLUMNS) {
    const a = source[k];
    const b = copy[k];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) (patch as Record<string, unknown>)[k] = a;
  }
  return Object.keys(patch).length ? patch : null;
}

/** Every thread in the same groups as these, the threads themselves included. */
export async function withTwins(db: Pick<Db, "select">, threadIds: string[]): Promise<string[]> {
  if (!threadIds.length) return [];
  const own = db
    .select({ groupId: threads.groupId })
    .from(threads)
    .where(and(inArray(threads.id, threadIds), isNotNull(threads.groupId)));
  const rows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(or(inArray(threads.id, threadIds), inArray(threads.groupId, own)));
  return rows.map((r) => r.id);
}

/**
 * Link a thread with its copies in other accounts, merging their groups. Returns the group id and
 * whether this call changed any link.
 */
export async function linkTwins(tx: Conn, threadId: string): Promise<{ groupId: string | null; linked: boolean }> {
  const [self] = await tx
    .select({ accountId: threads.accountId, groupId: threads.groupId })
    .from(threads)
    .where(eq(threads.id, threadId));
  if (!self) return { groupId: null, linked: false };

  const ids = tx
    .select({ id: sql`${messages.headers}->>'messageId'` })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNotNull(sql`${messages.headers}->>'messageId'`)));
  const found = await tx
    .selectDistinct({ id: threads.id, key: sql<string>`${groupKey}::text` })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(inArray(sql`${messages.headers}->>'messageId'`, ids), ne(threads.accountId, self.accountId)));
  if (!found.length) return { groupId: self.groupId, linked: false };

  const keys = new Set([self.groupId ?? threadId, ...found.map((f) => f.key)]);
  const groupId = mergedGroupId(keys);
  const changed = await tx
    .update(threads)
    .set({ groupId })
    .where(
      and(
        or(inArray(threads.id, [...keys]), inArray(threads.groupId, [...keys])),
        or(isNull(threads.groupId), ne(threads.groupId, groupId)),
      ),
    )
    .returning({ id: threads.id });
  return { groupId, linked: changed.length > 0 };
}

const stateColumns = Object.fromEntries(STATE_COLUMNS.map((c) => [c, threads[c]])) as {
  [K in (typeof STATE_COLUMNS)[number]]: (typeof threads)[K];
};

export type Reconciled = { source: string; changed: { id: string; patch: Partial<ThreadState> }[]; batchId: string };

/**
 * Make a group's copies agree on user-set state (snooze, pin, archive, trash, bucket, read) by
 * copying the copy the user acted on last onto the others. Without a user action it leaves them
 * be, unless `joining` names new copies: those take the state of the best other copy (compareCopies),
 * as long as it has been classified or moved, so a new copy of a known conversation lands where the
 * user already put it. Logged as `reconcile` under one batch; mirrored changes enqueue writeback.
 */
export async function reconcileGroup(
  tx: Conn,
  groupId: string,
  { joining = [], now = new Date() }: { joining?: string[]; now?: Date } = {},
): Promise<Reconciled | null> {
  const copies = await tx
    .select({
      id: threads.id,
      accountId: threads.accountId,
      lastMessageAt: threads.lastMessageAt,
      summary: threads.summary,
      summaryMessageAt: threads.summaryMessageAt,
      ...stateColumns,
    })
    .from(threads)
    .where(eq(threads.groupId, groupId));
  if (copies.length < 2) return null;
  const ids = copies.map((c) => c.id);

  const actions = await tx
    .select({ threadId: actionsLog.threadId })
    .from(actionsLog)
    .where(and(inArray(actionsLog.threadId, ids), isNull(actionsLog.undoneAt), notInArray(actionsLog.action, MACHINE_ACTIONS)))
    .orderBy(desc(actionsLog.createdAt), asc(actionsLog.threadId))
    .limit(1);
  let sourceId = sourceCopy(actions, ids);
  let targets = copies.filter((c) => c.id !== sourceId);
  if (!sourceId) {
    const others = copies.filter((c) => !joining.includes(c.id)).sort((a, b) => compareCopies(a, b, now));
    const best = others[0];
    if (!joining.length || !best || best.bucketSource === null) return null;
    sourceId = best.id;
    targets = copies.filter((c) => joining.includes(c.id));
  }
  const source = copies.find((c) => c.id === sourceId)!;

  const batchId = randomUUID();
  const changed: Reconciled["changed"] = [];
  for (const t of targets) {
    const patch = reconcilePatch(source, t);
    if (!patch) continue;
    // The summary describes the same messages; a joining copy borrows it instead of asking again.
    const summary = t.summary === null && source.summary !== null ? { summary: source.summary, summaryMessageAt: source.summaryMessageAt } : {};
    await tx.update(threads).set({ ...patch, ...summary }).where(eq(threads.id, t.id));
    await tx.insert(actionsLog).values({
      threadId: t.id,
      batchId,
      action: "reconcile",
      payload: { before: before(t, patch), source: source.id },
    });
    if (touchesMirror(patch)) await enqueueWriteback(tx, t);
    changed.push({ id: t.id, patch });
  }
  return { source: source.id, changed, batchId };
}

/** Dedupe a merged timeline: one message per Message-ID, the first copy given wins, oldest first. */
export function mergeTimeline<M extends { id: string; date: Date | string; messageId?: string | null }>(lists: M[][]): M[] {
  const seen = new Set<string>();
  const out: M[] = [];
  for (const list of lists) {
    for (const m of list) {
      const key = m.messageId || `id:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * The copy a reply leaves from: the one whose account the latest inbound message was addressed to
 * (to or cc), else the given copy.
 */
export function replyCopy(
  copies: { id: string; accountEmail: string }[],
  latestInbound: { to: { email: string }[]; cc: { email: string }[] } | undefined,
  fallback: string,
): string {
  if (!latestInbound) return fallback;
  const to = new Set([...latestInbound.to, ...latestInbound.cc].map((a) => a.email.toLowerCase()));
  const own = copies.find((c) => c.id === fallback);
  if (own && to.has(own.accountEmail.toLowerCase())) return fallback;
  return copies.find((c) => to.has(c.accountEmail.toLowerCase()))?.id ?? fallback;
}
