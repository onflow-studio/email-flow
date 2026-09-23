"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { runSenderAction, runThreadAction } from "@/app/(mail)/thread-actions";
import type { Bucket } from "@/lib/db/schema";
import type { ActionResult, MovableBucket, SenderAction, ThreadAction } from "@/lib/actions/types";

import { useKeys, type KeyBinding } from "../keys/keymap";
import { useMailSelection } from "../selection";
import { fullTime } from "../time";
import { findView, mailHref, type ViewSlug } from "../views";
import { SnoozePicker } from "./snooze-picker";
import { useUndo } from "./undo";

/** What the client knows about a thread to pick and describe actions. */
export type ActionTarget = {
  id: string;
  bucket: Bucket;
  senderId: string | null;
  setAside: boolean;
  snoozedUntil: string | null;
};

type ThreadActions = {
  run: (action: ThreadAction, ids?: string[]) => Promise<ActionResult | null>;
  runSender: (action: SenderAction, id?: string) => Promise<ActionResult | null>;
  openSnooze: () => void;
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

export function describeAction(action: ThreadAction | SenderAction, count: number) {
  const n = count > 1 ? `${count} ` : "";
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
      return `${n}moved to ${BUCKET_NAMES[action.bucket]}`;
    case "snooze":
      return `${n}snoozed until ${fullTime(action.until)}${action.needsReply ? ", needs reply" : ""}`;
    case "unsnooze":
      return `${n}unsnoozed`;
    case "setAside":
      return `${n}set aside`;
    case "unsetAside":
      return `${n}no longer set aside`;
    case "letIn":
      return count ? `let in, ${count} out of triage` : "let in";
    case "keepOut":
      return "kept out";
    case "undoAiAllow":
      return count ? `back to triage, ${count} moved` : "back to triage";
  }
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
    case "spam":
      return view !== "trash";
    case "snooze":
      return view !== "snoozed";
    case "unsnooze":
      return view === "snoozed";
    case "setAside":
      return view !== "set-aside";
    case "unsetAside":
      return view === "set-aside";
    case "move":
      return !!bucket && bucket !== action.bucket;
    // Screener moves change the bucket only; snoozed and set aside cut across buckets.
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
  const { report, undoLast } = useUndo();
  const [snoozeIds, setSnoozeIds] = useState<string[] | null>(null);

  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
  const target = sel.target ? (byId.get(sel.target) ?? null) : null;

  // With the acted-on thread open and leaving the view, step to its neighbour.
  const afterAction = useCallback(
    (action: ThreadAction | SenderAction, ids: string[]) => {
      if (!sel.openId || !ids.includes(sel.openId) || !leavesView(action, sel.view)) return;
      const i = sel.threadIds.indexOf(sel.openId);
      const rest = sel.threadIds.filter((id) => !ids.includes(id));
      const next = rest[Math.min(Math.max(i, 0), rest.length - 1)];
      router.push(mailHref(sel.view, { threadId: next ?? null, account: sel.account }), { scroll: false });
    },
    [router, sel.openId, sel.threadIds, sel.view, sel.account],
  );

  const run = useCallback(
    async (action: ThreadAction, ids?: string[]) => {
      const targetIds = ids ?? (sel.target ? [sel.target] : []);
      if (!targetIds.length) return null;
      try {
        const result = await runThreadAction(targetIds, action);
        if (result.count) {
          report(describeAction(action, result.count), result.token);
          afterAction(action, targetIds);
        }
        return result;
      } catch {
        report(`${action.type} failed, retry`);
        return null;
      }
    },
    [sel.target, report, afterAction],
  );

  const runSender = useCallback(
    async (action: SenderAction, id?: string) => {
      const threadId = id ?? sel.target;
      if (!threadId) return null;
      if (!byId.get(threadId)?.senderId) {
        report("no sender to decide on");
        return null;
      }
      try {
        const result = await runSenderAction(threadId, action);
        report(describeAction(action, result.count), result.token);
        afterAction(action, [threadId]);
        return result;
      } catch {
        report("screener failed, retry");
        return null;
      }
    },
    [sel.target, byId, report, afterAction],
  );

  const openSnooze = useCallback(() => {
    if (sel.target) setSnoozeIds([sel.target]);
  }, [sel.target]);

  const move = (bucket: MovableBucket): KeyBinding => ({
    keys: { inbox: "1", news: "2", paper_trail: "3" }[bucket],
    label: `move to ${BUCKET_NAMES[bucket]}`,
    group: "triage",
    when: () => !!target,
    run: () => void run({ type: "move", bucket }),
  });
  const inTriage = () => target?.bucket === "triage";

  useKeys([
    { keys: "e", label: "archive", group: "triage", when: () => !!target, run: () => void run({ type: "archive" }) },
    { keys: "s", label: "snooze", group: "triage", when: () => !!target, run: openSnooze },
    {
      keys: "h",
      label: "set aside",
      group: "triage",
      when: () => !!target,
      run: () => void run({ type: target?.setAside ? "unsetAside" : "setAside" }),
    },
    move("inbox"),
    move("news"),
    move("paper_trail"),
    { keys: "i", label: "let in", group: "screener", when: inTriage, run: () => void runSender({ type: "letIn" }) },
    { keys: "x", label: "keep out", group: "screener", when: inTriage, run: () => void runSender({ type: "keepOut" }) },
    { keys: "#", label: "delete", group: "triage", when: () => !!target, run: () => void run({ type: "trash" }) },
    { keys: "!", label: "mark spam", group: "triage", when: () => !!target, run: () => void run({ type: "spam" }) },
    { keys: "U", label: "mark unread", group: "triage", when: () => !!target, run: () => void run({ type: "unread" }) },
    { keys: "u", label: "undo last", group: "general", run: undoLast },
  ]);

  const value = useMemo(() => ({ run, runSender, openSnooze, target }), [run, runSender, openSnooze, target]);

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {snoozeIds ? (
        <SnoozePicker
          onClose={() => setSnoozeIds(null)}
          onPick={(snooze) => {
            setSnoozeIds(null);
            void run({ type: "snooze", ...snooze }, snoozeIds);
          }}
        />
      ) : null}
    </ActionsContext.Provider>
  );
}
