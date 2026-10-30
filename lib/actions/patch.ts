import type { StarredFrom } from "@/lib/db/schema";

import { MIRRORED_COLUMNS, type ThreadAction, type ThreadState } from "./types";

/**
 * The change an action makes to one thread, or null when it would change
 * nothing (archiving an archived thread, moving to the same bucket).
 */
export function patchFor(action: ThreadAction, t: ThreadState, now: Date): Partial<ThreadState> | null {
  const patch = rawPatch(action, t, now);
  if (!patch) return null;
  const changed = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => !same(t[k as keyof ThreadState], v)),
  ) as Partial<ThreadState>;
  return Object.keys(changed).length ? changed : null;
}

function rawPatch(action: ThreadAction, t: ThreadState, now: Date): Partial<ThreadState> | null {
  switch (action.type) {
    // Archiving, deleting or marking spam a Work or starred thread also takes it out of Work or Starred.
    case "archive":
    case "done":
      return { archived: true, workAt: null, ...UNSTARRED };
    case "unarchive":
      return { archived: false, trashed: false, spam: false };
    case "trash":
      return { trashed: true, workAt: null, ...UNSTARRED };
    case "restore":
      return { trashed: false };
    case "spam":
      return { spam: true, workAt: null, ...UNSTARRED };
    case "read":
      return { seenAt: t.seenAt ?? now };
    case "unread":
      return { seenAt: null };
    case "move":
      // Moving to the current bucket confirms an AI placement; Paper Trail and Receipts also clear unread attention.
      // A move, a snooze or Work sends a starred thread somewhere, so it leaves Starred.
      // A move to a bucket also takes the thread out of its project.
      return {
        ...UNSTARRED,
        projectId: null,
        projectSource: null,
        bucket: action.bucket,
        bucketSource: "user",
        bucketConfidence: 1,
        bucketSuggested: false,
        ...(action.bucket === "paper_trail" || action.bucket === "receipts" ? { seenAt: t.seenAt ?? now } : {}),
      };
    // Like a move: the thread leaves its bucket's view (or comes back to it), a live one stays live.
    // Put into a project, it also leaves Work: the project is where it lives now.
    case "project":
      return {
        ...UNSTARRED,
        ...(action.projectId ? { workAt: null } : {}),
        projectId: action.projectId,
        projectSource: action.projectId ? "user" : null,
      };
    case "snooze": {
      const until = new Date(action.until);
      if (Number.isNaN(until.getTime()) || until <= now) return null;
      const deadline = action.deadline ? new Date(action.deadline) : null;
      return {
        ...UNSTARRED,
        snoozedUntil: until,
        needsReply: action.needsReply ?? false,
        deadlineAt: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      };
    }
    case "flag": {
      const deadline = action.deadline ? new Date(action.deadline) : null;
      return {
        ...(action.needsReply === undefined ? {} : { needsReply: action.needsReply }),
        ...(action.deadline === undefined ? {} : { deadlineAt: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null }),
      };
    }
    case "unsnooze":
      return { snoozedUntil: null };
    // Work holds live threads: restore and unsnooze a thread moved there from anywhere.
    case "work":
      return { workAt: t.workAt ?? now, archived: false, trashed: false, spam: false, snoozedUntil: null, ...UNSTARRED };
    // Starred holds live threads too. Starring never changes the bucket, and keeps a snooze so unstar can return to it.
    case "star":
      if (t.starredAt) return null;
      return { starredAt: now, starredFrom: starredFrom(t, now), archived: false, trashed: false, spam: false, workAt: null };
    case "unstar":
      if (!t.starredAt) return null;
      return {
        ...UNSTARRED,
        ...(t.starredFrom === "archived" ? { archived: true } : {}),
        ...(t.starredFrom === "work" ? { workAt: now } : {}),
      };
  }
}

const UNSTARRED = { starredAt: null, starredFrom: null } satisfies Partial<ThreadState>;

/** Where a thread is before it is starred, which is where unstarring puts it back. */
export function starredFrom(t: Pick<ThreadState, "workAt" | "snoozedUntil" | "archived">, now: Date): StarredFrom {
  if (t.workAt) return "work";
  if (t.snoozedUntil && t.snoozedUntil > now) return "snoozed";
  if (t.archived) return "archived";
  return "bucket";
}

function same(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export function touchesMirror(patch: Partial<ThreadState>) {
  return Object.keys(patch).some((k) => MIRRORED_COLUMNS.has(k as keyof ThreadState));
}

/** The prior values of the columns a patch changes: what undo writes back. */
export function before(t: ThreadState, patch: Partial<ThreadState>): Partial<ThreadState> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, t[k as keyof ThreadState]])) as Partial<ThreadState>;
}
