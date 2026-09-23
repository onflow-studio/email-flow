"use client";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import { Button } from "@/components/ui/button";

import { useThreadActions } from "./actions";

/** Mouse and touch path to the same actions the keys run. */
export function ActionToolbar({ thread }: { thread: ThreadDetail }) {
  const { run, runSender, openSnooze, unsubscribe } = useThreadActions();
  const ids = [thread.id];

  return (
    <div role="toolbar" aria-label="thread actions" className="-ml-3 flex flex-wrap items-center">
      {thread.bucket === "triage" ? (
        <>
          <Button variant="ghost" shortcut="i" onClick={() => void runSender({ type: "letIn" }, thread.id)}>
            let in
          </Button>
          <Button variant="ghost" shortcut="x" onClick={() => void runSender({ type: "keepOut" }, thread.id)}>
            keep out
          </Button>
        </>
      ) : null}
      <Button variant="ghost" shortcut="e" onClick={() => void run({ type: "archive" }, ids)}>
        archive
      </Button>
      <Button variant="ghost" shortcut="s" onClick={openSnooze}>
        snooze
      </Button>
      {thread.snoozedUntil ? (
        <Button variant="ghost" onClick={() => void run({ type: "unsnooze" }, ids)}>
          unsnooze
        </Button>
      ) : null}
      <Button
        variant="ghost"
        shortcut="h"
        onClick={() => void run({ type: thread.setAside ? "unsetAside" : "setAside" }, ids)}
      >
        {thread.setAside ? "unset aside" : "set aside"}
      </Button>
      {thread.canUnsubscribe ? (
        <Button variant="ghost" shortcut="u" onClick={() => void unsubscribe(thread.id)}>
          unsubscribe
        </Button>
      ) : null}
      {thread.trashed ? (
        <Button variant="ghost" onClick={() => void run({ type: "restore" }, ids)}>
          restore
        </Button>
      ) : (
        // Phone has delete in the sticky thread header instead.
        <Button variant="destructive" shortcut="#" className="ml-2 hidden md:inline-flex" onClick={() => void run({ type: "trash" }, ids)}>
          delete
        </Button>
      )}
    </div>
  );
}
