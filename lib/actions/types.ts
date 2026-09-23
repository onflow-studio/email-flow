import type { Bucket, Thread } from "@/lib/db/schema";

export type MovableBucket = Exclude<Bucket, "triage" | "out">;

/** Actions on the threads themselves. All of them work in bulk. */
export type ThreadAction =
  | { type: "archive" }
  | { type: "unarchive" }
  | { type: "trash" }
  | { type: "restore" }
  | { type: "spam" }
  | { type: "read" }
  | { type: "unread" }
  | { type: "move"; bucket: MovableBucket }
  | { type: "snooze"; until: string; needsReply?: boolean; deadline?: string | null }
  | { type: "unsnooze" }
  | { type: "setAside" }
  | { type: "unsetAside" };

/** Actions on a thread's sender, through the screener. */
export type SenderAction =
  | { type: "letIn" }
  | { type: "keepOut"; spam?: boolean }
  | { type: "undoAiAllow" };

export type Action = ThreadAction | SenderAction;
export type ActionType = Action["type"];

export const SENDER_ACTIONS = new Set<ActionType>(["letIn", "keepOut", "undoAiAllow"]);

export function isSenderAction(action: Action): action is SenderAction {
  return SENDER_ACTIONS.has(action.type);
}

/** Thread columns an action may change, and so what undo restores. */
export const STATE_COLUMNS = [
  "bucket",
  "bucketSource",
  "bucketConfidence",
  "bucketSuggested",
  "seenAt",
  "snoozedUntil",
  "needsReply",
  "deadlineAt",
  "setAsideAt",
  "archived",
  "trashed",
  "spam",
] as const satisfies readonly (keyof Thread)[];

export type ThreadState = Pick<Thread, (typeof STATE_COLUMNS)[number]>;

/** Columns mirrored to Gmail; a change to any of them enqueues writeback. */
export const MIRRORED_COLUMNS = new Set<keyof ThreadState>(["bucket", "archived", "seenAt", "trashed", "spam"]);

export type ActionResult = {
  /** Undo token. Null when nothing changed. */
  token: string | null;
  /** Threads changed. */
  count: number;
};

export type PreviewThread = {
  id: string;
  subject: string;
  sender: string;
  account: string;
  lastMessageAt: string;
};

export type ActionPreview = {
  action: ThreadAction;
  /** Threads the action would change; no-ops (already archived, same bucket) are left out. */
  threads: PreviewThread[];
  count: number;
};
