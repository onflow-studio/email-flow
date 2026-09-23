"use server";

import { refresh } from "next/cache";

import {
  applySenderAction,
  applyThreadAction,
  markSeenOnOpen,
  previewThreadAction,
  undoAction,
  unsubscribeThread,
  type ActionPreview,
  type ActionResult,
  type SenderAction,
  type ThreadAction,
  type UnsubscribeResult,
} from "@/lib/actions";
import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK = 1000;

function ids(threadIds: unknown): string[] {
  if (!Array.isArray(threadIds) || threadIds.length > MAX_BULK || !threadIds.every((id) => typeof id === "string" && UUID.test(id))) {
    throw new Error("invalid thread ids");
  }
  return threadIds;
}

const SIMPLE = new Set(["archive", "unarchive", "trash", "restore", "spam", "read", "unread", "unsnooze", "setAside", "unsetAside"]);
const MOVABLE = new Set(["inbox", "news", "paper_trail"]);
const isDate = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function threadAction(a: unknown): ThreadAction {
  const action = a as ThreadAction;
  if (SIMPLE.has(action?.type)) return { type: action.type } as ThreadAction;
  if (action?.type === "move" && MOVABLE.has(action.bucket)) return { type: "move", bucket: action.bucket };
  if (action?.type === "snooze" && isDate(action.until) && (action.deadline == null || isDate(action.deadline))) {
    return { type: "snooze", until: action.until, needsReply: !!action.needsReply, deadline: action.deadline ?? null };
  }
  throw new Error("invalid action");
}

function senderAction(a: unknown): SenderAction {
  const action = a as SenderAction;
  if (action?.type === "letIn" || action?.type === "undoAiAllow") return { type: action.type };
  if (action?.type === "keepOut") return { type: "keepOut", spam: !!action.spam };
  throw new Error("invalid action");
}

export async function runThreadAction(threadIds: string[], action: ThreadAction): Promise<ActionResult> {
  const result = await applyThreadAction(db, ids(threadIds), threadAction(action));
  refresh();
  return result;
}

export async function runSenderAction(threadId: string, action: SenderAction): Promise<ActionResult> {
  const [id] = ids([threadId]);
  const result = await applySenderAction(db, id, senderAction(action));
  refresh();
  return result;
}

export async function unsubscribe(threadId: string): Promise<UnsubscribeResult> {
  const [id] = ids([threadId]);
  const result = await unsubscribeThread(db, id);
  if (result.kind === "sent") refresh();
  return result;
}

export async function undo(token: string): Promise<{ count: number; unsubscribed: boolean }> {
  const [id] = ids([token]);
  const result = await undoAction(db, id);
  refresh();
  return result;
}

/** Bulk preview for the palette: which threads the action would change. */
export async function previewAction(threadIds: string[], action: ThreadAction): Promise<ActionPreview> {
  return previewThreadAction(db, ids(threadIds), threadAction(action));
}

export async function markSeen(threadId: string): Promise<void> {
  const [id] = ids([threadId]);
  if (await markSeenOnOpen(db, id)) refresh();
}
