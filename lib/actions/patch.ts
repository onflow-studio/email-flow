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
    // Archiving, deleting or marking spam a Work thread also takes it out of Work.
    case "archive":
    case "done":
      return { archived: true, workAt: null };
    case "unarchive":
      return { archived: false, trashed: false, spam: false };
    case "trash":
      return { trashed: true, workAt: null };
    case "restore":
      return { trashed: false };
    case "spam":
      return { spam: true, workAt: null };
    case "read":
      return { seenAt: t.seenAt ?? now };
    case "unread":
      return { seenAt: null };
    case "move":
      // Moving to the current bucket confirms an AI placement; Paper Trail also clears unread attention.
      return {
        bucket: action.bucket,
        bucketSource: "user",
        bucketConfidence: 1,
        bucketSuggested: false,
        ...(action.bucket === "paper_trail" ? { seenAt: t.seenAt ?? now } : {}),
      };
    case "snooze": {
      const until = new Date(action.until);
      if (Number.isNaN(until.getTime()) || until <= now) return null;
      const deadline = action.deadline ? new Date(action.deadline) : null;
      return {
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
    // Work holds live threads: one picked from the archive comes back.
    case "work":
      return { workAt: t.workAt ?? now, archived: false };
  }
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
