import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

/**
 * Opening a thread marks it seen and mirrors read state to Gmail. A past-due
 * snooze counts as resurfaced until opened, so opening also clears it. Not
 * logged: `u` undoes what the user did, not what reading implied.
 */
export async function markSeenOnOpen(db: Db, threadId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: threads.id, accountId: threads.accountId, seenAt: threads.seenAt, snoozedUntil: threads.snoozedUntil })
      .from(threads)
      .where(eq(threads.id, threadId));
    if (!t) return false;

    const now = new Date();
    const resurfaced = t.snoozedUntil !== null && t.snoozedUntil <= now;
    const unseen = t.seenAt === null || resurfaced;
    if (!unseen) return false;

    await tx
      .update(threads)
      .set({ seenAt: now, ...(resurfaced ? { snoozedUntil: null } : {}) })
      .where(eq(threads.id, threadId));
    if (t.seenAt === null) await enqueueWriteback(tx, t);
    return true;
  });
}
