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
    case "archive":
      return { archived: true };
    case "unarchive":
      return { archived: false, trashed: false, spam: false };
    case "trash":
      return { trashed: true };
    case "restore":
      return { trashed: false };
    case "spam":
      return { spam: true };
    case "read":
      return { seenAt: t.seenAt ?? now };
    case "unread":
      return { seenAt: null };
    case "move":
      return t.bucket === action.bucket
        ? null
        : { bucket: action.bucket, bucketSource: "user", bucketConfidence: 1, bucketSuggested: false };
    case "snooze": {
      const until = new Date(action.until);
      if (Number.isNaN(until.getTime()) || until <= now) return null;
      const deadline = action.deadline ? new Date(action.deadline) : null;
      return {
        snoozedUntil: until,
        needsReply: action.needsReply ?? false,
        deadlineAt: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
        setAsideAt: null,
      };
    }
    case "unsnooze":
      return { snoozedUntil: null };
    case "setAside":
      return { setAsideAt: t.setAsideAt ?? now, snoozedUntil: null };
    case "unsetAside":
      return { setAsideAt: null };
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
