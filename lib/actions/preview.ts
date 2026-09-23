import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { accounts, threads } from "@/lib/db/schema";

import { loadStates } from "./apply";
import { patchFor } from "./patch";
import type { ActionPreview, ThreadAction } from "./types";

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
