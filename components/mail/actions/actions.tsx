"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { runSenderAction, runThreadAction, unsubscribe as unsubscribeAction } from "@/app/(mail)/thread-actions";
import type { Bucket } from "@/lib/db/schema";
import type { ActionResult, MovableBucket, SenderAction, ThreadAction } from "@/lib/actions/types";

import { useCompose } from "../compose/compose";
import { useKeys, type KeyBinding } from "../keys/keymap";
import { useMailSelection } from "../selection";
import { fullTime } from "../time";
import { findView, mailHref, type ViewSlug } from "../views";
import { DeadlinePicker, SnoozePicker } from "./snooze-picker";
import { useUndo } from "./undo";

/** What the client knows about a thread to pick and describe actions. */
export type ActionTarget = {
  id: string;
  bucket: Bucket;
  senderId: string | null;
  work: boolean;
  snoozedUntil: string | null;
  needsReply: boolean;
  deadlineAt: string | null;
};

type ThreadActions = {
  run: (action: ThreadAction, ids?: string[]) => Promise<ActionResult | null>;
  runSender: (action: SenderAction, id?: string) => Promise<ActionResult | null>;
  openSnooze: () => void;
  openDeadline: () => void;
  /** `w`: into Work, or done when already there. */
  toggleWork: (id?: string) => Promise<ActionResult | null>;
  unsubscribe: (id?: string) => Promise<void>;
  target: ActionTarget | null;
};

const ActionsContext = createContext<ThreadActions | null>(null);

export function useThreadActions() {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useThreadActions must be used inside <ActionsProvider>");
  return ctx;
}

const BUCKET_NAMES: Record<Bucket, string> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper trail",
  triage: "triage",
  out: "out",
};

/** Up to two sender names, then `+N` for the rest: `Nora Quint, Teo Marsh +1`. */
export function senderList(names: string[]) {
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

/** `kept` marks a move to the bucket the threads were already in: a confirmation, not a move. */
export function describeAction(action: ThreadAction | SenderAction, count: number, kept = false, senders: string[] = []) {
  const n = count > 1 ? `${count} ` : "";
  const who = senders.length ? ` ${senderList(senders)}` : "";
  switch (action.type) {
    case "archive":
      return `${n}archived`;
    case "unarchive":
      return `${n}unarchived`;
    case "trash":
      return `${n}deleted`;
    case "restore":
      return `${n}restored`;
    case "spam":
      return `${n}marked spam`;
    case "read":
      return `${n}marked read`;
    case "unread":
      return `${n}marked unread`;
    case "move":
      return `${n}${kept ? "kept in" : "moved to"} ${BUCKET_NAMES[action.bucket]}`;
    case "snooze":
      return `${n}snoozed until ${fullTime(action.until)}${action.needsReply ? ", needs reply" : ""}`;
    case "unsnooze":
      return `${n}unsnoozed`;
    case "work":
      return `${n}moved to work`;
    case "done":
      return `${n}done`;
    case "flag":
      return flagLine(action, n);
    case "letIn":
      return count ? `let in${who}, ${count} out of triage` : `let in${who}`;
    case "confirmAiAllow":
      return `let in${who}`;
    case "keepOut":
      return `kept out${who}`;
    case "undoAiAllow":
      return count ? `back to triage, ${count} moved` : "back to triage";
  }
}

function flagLine(action: Extract<ThreadAction, { type: "flag" }>, n: string) {
  const parts = [
    action.needsReply === undefined ? null : action.needsReply ? "needs reply" : "no reply needed",
    action.deadline === undefined ? null : action.deadline ? `due ${fullTime(action.deadline)}` : "deadline cleared",
  ].filter(Boolean);
  return `${n}${parts.join(", ")}`;
}

/** Whether the action takes the thread out of the current view. */
function leavesView(action: ThreadAction | SenderAction, view: ViewSlug) {
  const bucket = findView(view)?.bucket;
  switch (action.type) {
    case "trash":
      return true;
    case "restore":
      return view === "trash";
    // Trash lists trashed threads whatever else they are.
    case "archive":
    case "done":
    case "spam":
      return view !== "trash";
    case "snooze":
      return view !== "snoozed";
    case "unsnooze":
      return view === "snoozed";
    // Work threads leave every bucket view.
    case "work":
      return !!bucket || view === "snoozed" || view === "trash";
    case "move":
      return !!bucket && bucket !== action.bucket;
    // Screener moves change the bucket only; work and snoozed cut across buckets.
    case "letIn":
      return bucket === "triage";
    case "keepOut":
      return !!bucket;
    case "undoAiAllow":
      return !!bucket && bucket !== "triage";
    default:
      return false;
  }
}

export function ActionsProvider({ targets, children }: { targets: ActionTarget[]; children: React.ReactNode }) {
  const sel = useMailSelection();
  const router = useRouter();
  const { report, notify, undoLast } = useUndo();
  const [snoozeIds, setSnoozeIds] = useState<string[] | null>(null);
  const [deadlineId, setDeadlineId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
  const target = sel.target ? (byId.get(sel.target) ?? null) : null;

  // The picker shows a snooze still ahead, so rescheduling never looks like nothing was set.
  const [openedAt, setOpenedAt] = useState(0);
  const snoozedUntil = (ids: string[]) => {
    const until = ids.length === 1 ? byId.get(ids[0])?.snoozedUntil : null;
    return until && new Date(until).getTime() > openedAt ? until : null;
  };

  // With the acted-on thread open and leaving the view, step to its neighbour.
  const afterAction = useCallback(
    (action: ThreadAction | SenderAction, ids: string[]) => {
      if (!sel.openId || !ids.includes(sel.openId) || !leavesView(action, sel.view)) return;
      const i = sel.threadIds.indexOf(sel.openId);
      const rest = sel.threadIds.filter((id) => !ids.includes(id));
      const next = rest[Math.min(Math.max(i, 0), rest.length - 1)];
      router.push(mailHref(sel.view, { threadId: next ?? null }), { scroll: false });
    },
    [router, sel.openId, sel.threadIds, sel.view],
  );

  const run = useCallback(
    async (action: ThreadAction, ids?: string[]) => {
      const targetIds = ids ?? (sel.target ? [sel.target] : []);
      if (!targetIds.length) return null;
      try {
        // A move to the bucket every thread is already in confirms the placement instead.
        const kept = action.type === "move" && targetIds.every((id) => byId.get(id)?.bucket === action.bucket) ? action.bucket : null;
        const result = await runThreadAction(targetIds, action);
        if (result.count) {
          report(describeAction(action, result.count, !!kept), result.token);
          afterAction(action, targetIds);
        } else if (kept) notify(`already in ${BUCKET_NAMES[kept]}`, "warning");
        else if (action.type === "work") notify("already in work", "warning");
        return result;
      } catch {
        notify(`${action.type} failed, retry`, "error");
        return null;
      }
    },
    [sel.target, byId, report, notify, afterAction],
  );

  const runSender = useCallback(
    async (action: SenderAction, id?: string) => {
      const threadId = id ?? sel.target;
      if (!threadId) return null;
      if (!byId.get(threadId)?.senderId) {
        notify("no sender to decide on", "warning");
        return null;
      }
      try {
        const result = await runSenderAction(threadId, action);
        report(describeAction(action, result.count, false, result.senders), result.token);
        afterAction(action, [threadId]);
        return result;
      } catch {
        notify("screener failed, retry", "error");
        return null;
      }
    },
    [sel.target, byId, report, notify, afterAction],
  );

  const unsubscribe = useCallback(
    async (id?: string) => {
      const threadId = id ?? sel.target;
      if (!threadId) return;
      try {
        const result = await unsubscribeAction(threadId);
        if (result.kind === "sent") {
          report(`unsubscribed from ${result.sender}`, result.token);
          afterAction({ type: "archive" }, [threadId]);
        } else if (result.kind === "open") {
          const url = new URL(result.url);
          if (url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer");
          report("unsubscribe page opened");
        } else if (result.kind === "none") notify("no unsubscribe link", "warning");
        else notify("unsubscribe failed, retry", "error");
      } catch {
        notify("unsubscribe failed, retry", "error");
      }
    },
    [sel.target, report, notify, afterAction],
  );

  const openSnooze = useCallback(() => {
    if (!sel.target) return;
    setOpenedAt(Date.now());
    setSnoozeIds([sel.target]);
  }, [sel.target]);

  const openDeadline = useCallback(() => {
    if (sel.target) setDeadlineId(sel.target);
  }, [sel.target]);

  const toggleWork = useCallback(
    (id?: string) => {
      const threadId = id ?? sel.target;
      if (!threadId) return Promise.resolve(null);
      return run({ type: sel.view === "work" && byId.get(threadId)?.work ? "done" : "work" }, [threadId]);
    },
    [sel.target, sel.view, byId, run],
  );

  // The sent toast after a reply on a Work thread offers done through this.
  const compose = useCompose();
  useEffect(() => compose.onDone((id) => void run({ type: "done" }, [id])), [compose, run]);

  const move = (bucket: MovableBucket): KeyBinding => ({
    id: `move.${bucket}`,
    when: () => !!target,
    run: () => void run({ type: "move", bucket }),
  });
  const inTriage = () => target?.bucket === "triage";

  useKeys([
    { id: "archive", when: () => !!target, run: () => void run({ type: "archive" }) },
    { id: "snooze", when: () => !!target, run: openSnooze },
    { id: "work", when: () => !!target, run: () => void toggleWork() },
    move("inbox"),
    move("news"),
    move("paper_trail"),
    { id: "let-in", when: inTriage, run: () => void runSender({ type: "letIn" }) },
    { id: "keep-out", when: inTriage, run: () => void runSender({ type: "keepOut" }) },
    { id: "delete", when: () => !!target, run: () => void run({ type: "trash" }) },
    { id: "spam", when: () => !!target, run: () => void run({ type: "spam" }) },
    { id: "unread", when: () => !!target, run: () => void run({ type: "unread" }) },
    { id: "unsubscribe", when: () => !!target, run: () => void unsubscribe() },
    { id: "undo", run: undoLast },
  ]);

  const value = useMemo(
    () => ({ run, runSender, openSnooze, openDeadline, toggleWork, unsubscribe, target }),
    [run, runSender, openSnooze, openDeadline, toggleWork, unsubscribe, target],
  );

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {snoozeIds ? (
        <SnoozePicker
          snoozedUntil={snoozedUntil(snoozeIds)}
          needsReply={snoozeIds.length === 1 ? !!byId.get(snoozeIds[0])?.needsReply : false}
          deadline={snoozeIds.length === 1 ? (byId.get(snoozeIds[0])?.deadlineAt ?? null) : null}
          onUnsnooze={() => {
            setSnoozeIds(null);
            void run({ type: "unsnooze" }, snoozeIds);
          }}
          onClose={() => setSnoozeIds(null)}
          onPick={(snooze) => {
            setSnoozeIds(null);
            void run({ type: "snooze", ...snooze }, snoozeIds);
          }}
        />
      ) : null}
      {deadlineId ? (
        <DeadlinePicker
          deadline={byId.get(deadlineId)?.deadlineAt ?? null}
          onClose={() => setDeadlineId(null)}
          onPick={(deadline) => {
            setDeadlineId(null);
            void run({ type: "flag", deadline }, [deadlineId]);
          }}
        />
      ) : null}
    </ActionsContext.Provider>
  );
}
