"use server";

import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { refresh } from "next/cache";

import { applyThreadAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { saveWorkOn } from "@/lib/db/settings";

export type WorkState = { ok: boolean; message: string } | null;

/**
 * Turns the Work list on or off. Off, its live threads go to Inbox (a project keeps its own), and
 * the Work mark is cleared everywhere, so nothing waits there if it is turned on again.
 */
export async function setWorkOn(_prev: WorkState, form: FormData): Promise<WorkState> {
  const on = form.get("on") === "1";
  await saveWorkOn(db, on);
  if (on) {
    refresh();
    return { ok: true, message: "work list on" };
  }
  const live = and(isNotNull(threads.workAt), eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));
  const moving = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(live, isNull(threads.projectId), ne(threads.bucket, "inbox")));
  await applyThreadAction(db, moving.map((t) => t.id), { type: "move", bucket: "inbox" });
  const left = await db.update(threads).set({ workAt: null }).where(live).returning({ id: threads.id });
  // Done threads that kept the mark from before archive cleared it.
  await db.update(threads).set({ workAt: null }).where(isNotNull(threads.workAt));
  refresh();
  return { ok: true, message: left.length ? `work list off, ${left.length} ${left.length === 1 ? "thread" : "threads"} out of it` : "work list off" };
}
