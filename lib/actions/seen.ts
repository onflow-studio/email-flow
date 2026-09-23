import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";
import { withTwins } from "@/lib/sync/twins";

/**
 * Opening a thread marks it seen and mirrors read state to Gmail. A past-due
 * snooze counts as resurfaced until opened, so opening also clears it. Not
 * logged: `u` undoes what the user did, not what reading implied. Twins are read together.
 */
export async function markSeenOnOpen(db: Db, threadId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const copies = await tx
      .select({ id: threads.id, accountId: threads.accountId, seenAt: threads.seenAt, snoozedUntil: threads.snoozedUntil })
      .from(threads)
      .where(inArray(threads.id, await withTwins(tx, [threadId])));

    const now = new Date();
    let changed = false;
    for (const t of copies) {
      const resurfaced = t.snoozedUntil !== null && t.snoozedUntil <= now;
      const unseen = t.seenAt === null || resurfaced;
      if (!unseen) continue;
      changed = true;
      await tx
        .update(threads)
        .set({ seenAt: now, ...(resurfaced ? { snoozedUntil: null } : {}) })
        .where(eq(threads.id, t.id));
      if (t.seenAt === null) await enqueueWriteback(tx, t);
    }
    return changed;
  });
}
