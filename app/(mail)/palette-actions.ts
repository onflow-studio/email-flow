"use server";

import { countThreadActions, previewThreadAction, type ActionPreview, type ThreadAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { searchThreadIds, searchThreads, type SearchHit } from "@/lib/search";

import { accountsOff, accountsOn } from "./_lib/account-filter";
import { BULK_ACTIONS } from "./_lib/bulk";
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

export type PaletteSearch = {
  hits: SearchHit[];
  total: number;
  words: string[];
  /** Per BULK_ACTIONS key: how many matching threads the action would change. */
  counts: Record<string, number>;
};

export async function paletteSearch(input: string): Promise<PaletteSearch> {
  const q = query(input);
  const s = await scope();
  const [result, ids] = await Promise.all([searchThreads(db, q, s), searchThreadIds(db, q, s)]);
  const counts = await countThreadActions(db, ids, BULK_ACTIONS.map((a) => a.action));
  return {
    hits: result.hits,
    total: result.total,
    words: result.query.words,
    counts: Object.fromEntries(BULK_ACTIONS.map((a, i) => [a.key, counts[i]])),
  };
}

/** The threads a bulk action on the query's results would change. Execute with runThreadAction. */
export async function previewSearchAction(input: string, key: string): Promise<ActionPreview> {
  return previewThreadAction(db, await searchThreadIds(db, query(input), await scope()), bulkAction(key));
}
