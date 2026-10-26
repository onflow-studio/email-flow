"use server";

import {
  countBulkKeepOut,
  countThreadActions,
  previewBulkKeepOut,
  previewThreadAction,
  type ActionPreview,
  type KeepOutPreview,
  type ThreadAction,
} from "@/lib/actions";
import { db } from "@/lib/db";
import { searchThreadIds, searchThreads, type SearchHit } from "@/lib/search";

import { accountsOff, accountsOn } from "./_lib/account-filter";
import { BULK_ACTIONS, BULK_KEEP_OUT, BULK_SNOOZE } from "./_lib/bulk";
import { listAccounts } from "./_lib/queries";

const MAX_QUERY = 500;

function query(input: unknown): string {
  if (typeof input !== "string") throw new Error("invalid query");
  return input.slice(0, MAX_QUERY);
}

/** Search covers only the accounts toggled on in the header. */
async function scope() {
  return { accountIds: accountsOn(await listAccounts(), await accountsOff()) };
}

function bulkAction(key: unknown): ThreadAction {
  const found = BULK_ACTIONS.find((a) => a.key === key);
  if (!found) throw new Error("invalid action");
  return found.action;
}

const isDate = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function snoozeAction(input: unknown): ThreadAction {
  const s = (input ?? {}) as { until?: unknown; needsReply?: unknown; deadline?: unknown };
  if (!isDate(s.until) || !(s.deadline == null || isDate(s.deadline))) throw new Error("invalid snooze");
  return { type: "snooze", until: s.until as string, needsReply: s.needsReply === true, deadline: (s.deadline as string | null | undefined) ?? null };
}

// Counting needs a time to snooze until; any future one changes the same threads.
const SAMPLE_SNOOZE_MS = 24 * 60 * 60 * 1000;

export type PaletteSearch = {
  hits: SearchHit[];
  total: number;
  words: string[];
  /** Per BULK_ACTIONS key and snooze: how many matching threads the action would change. Per keep out key: how many senders. */
  counts: Record<string, number>;
};

export async function paletteSearch(input: string, { semantic = false }: { semantic?: boolean } = {}): Promise<PaletteSearch> {
  const q = query(input);
  const s = await scope();
  const [result, ids] = await Promise.all([searchThreads(db, q, s, 50, { semantic }), searchThreadIds(db, q, s)]);
  const snooze: ThreadAction = { type: "snooze", until: new Date(Date.now() + SAMPLE_SNOOZE_MS).toISOString() };
  const [counts, keepOut] = await Promise.all([
    countThreadActions(db, ids, [...BULK_ACTIONS.map((a) => a.action), snooze]),
    countBulkKeepOut(db, ids),
  ]);
  return {
    hits: result.hits,
    total: result.total,
    words: result.query.words,
    counts: Object.fromEntries([
      ...BULK_ACTIONS.map((a, i) => [a.key, counts[i]]),
      [BULK_SNOOZE.key, counts[BULK_ACTIONS.length]],
      ...BULK_KEEP_OUT.map((a) => [a.key, keepOut]),
    ]),
  };
}

/** The threads a bulk action on the query's results would change. Execute with runThreadAction. */
export async function previewSearchAction(input: string, key: string): Promise<ActionPreview> {
  return previewThreadAction(db, await searchThreadIds(db, query(input), await scope()), bulkAction(key));
}

/** The threads snoozing the query's results would change. Execute with runThreadAction. */
export async function previewSearchSnooze(
  input: string,
  snooze: { until: string; needsReply: boolean; deadline: string | null },
): Promise<ActionPreview> {
  return previewThreadAction(db, await searchThreadIds(db, query(input), await scope()), snoozeAction(snooze));
}

/** The senders keep out would decide on among the query's Triage results. Execute with runBulkKeepOut. */
export async function previewSearchKeepOut(input: string, key: string): Promise<KeepOutPreview> {
  const found = BULK_KEEP_OUT.find((a) => a.key === key);
  if (!found) throw new Error("invalid action");
  return previewBulkKeepOut(db, await searchThreadIds(db, query(input), await scope()), found.spam);
}
