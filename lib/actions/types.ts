import type { SenderChoice } from "@/lib/classify/screener";
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
  /** Into a project, or out of every project (null) back to its bucket. */
  | { type: "project"; projectId: string | null }
  | { type: "snooze"; until: string; needsReply?: boolean; deadline?: string | null }
  | { type: "unsnooze" }
  | { type: "work" }
  /** Finishes a Work thread: out of Work and archived. */
  | { type: "done" }
  /** Keeps the thread in Starred, out of every other view, remembering where it was. */
  | { type: "star" }
  /** Out of Starred, back to where it was when starred. */
  | { type: "unstar" }
  /** Sets needs reply and the deadline without snoozing; a field left out keeps its value. */
  | { type: "flag"; needsReply?: boolean; deadline?: string | null };

/** Actions on a thread's sender, through the screener. */
export type SenderAction =
  | { type: "letIn" }
  | { type: "keepOut"; spam?: boolean }
  | { type: "confirmAiAllow" }
  | { type: "undoAiAllow" }
  /** From the sender card: the thread's own sender, to a bucket for good or out. */
  | { type: "decideSender"; choice: SenderChoice };

export type Action = ThreadAction | SenderAction;
export type ActionType = Action["type"];

/** Thread columns an action may change, and so what undo restores. */
export const STATE_COLUMNS = [
  "bucket",
  "bucketSource",
  "bucketConfidence",
  "bucketSuggested",
  "projectId",
  "projectSource",
  "seenAt",
  "snoozedUntil",
  "needsReply",
  "deadlineAt",
  "workAt",
  "starredAt",
  "archived",
  "trashed",
  "spam",
] as const satisfies readonly (keyof Thread)[];

export type ThreadState = Pick<Thread, (typeof STATE_COLUMNS)[number]>;

/** Columns mirrored to Gmail; a change to any of them enqueues writeback. */
export const MIRRORED_COLUMNS = new Set<keyof ThreadState>(["bucket", "projectId", "archived", "seenAt", "trashed", "spam", "starredAt"]);

export type ActionResult = {
  /** Undo token. Null when nothing changed. */
  token: string | null;
  /** Threads changed. */
  count: number;
  /** Sender actions: the names of the senders decided, in thread order. */
  senders?: string[];
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

export type KeepOutPreview = {
  spam: boolean;
  /** Senders bulk keep out would decide on, each with the threads it would move out. */
  senders: { id: string; name: string; threads: number }[];
  /** The Triage threads the senders came from; pass them back to execute. */
  threadIds: string[];
  count: number;
};
