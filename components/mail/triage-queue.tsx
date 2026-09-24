"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { ThreadListItem } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { AccountSquare } from "./account-square";
import { ComposeButton } from "./compose/compose-keys";
import { useMailSelection } from "./selection";
import { mailHref } from "./views";

export function TriageQueue({ threads, accountColors }: { threads: ThreadListItem[]; accountColors: Record<string, string> }) {
  const sel = useMailSelection();
  const active = sel.openId ?? sel.focusedId;
  const position = active ? sel.threadIds.indexOf(active) : -1;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-thread-id="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!threads.length) {
    return (
      <div className="p-3">
        <p className="text-11 text-text-muted">sender decisions</p>
        <p className="mt-1 font-medium text-text">0 to decide</p>
        <p className="mt-4 text-text-muted">no senders waiting</p>
      </div>
    );
  }

  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ordered = sel.threadIds.flatMap((id) => byId.get(id) ?? []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-3">
        <p className="text-11 text-text-muted">sender decisions</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="font-medium text-text" aria-live="polite">
            {position < 0 ? `${ordered.length} to decide` : `${position + 1} of ${ordered.length}`}
          </p>
          <ComposeButton />
        </div>
      </div>
      <ol ref={listRef} aria-label="triage queue" className="min-h-0 flex-1 overflow-y-auto py-1">
        {ordered.map((thread) => (
          <li key={thread.id}>
            <Link
              href={mailHref("triage", { threadId: thread.id })}
              scroll={false}
              aria-current={thread.id === sel.openId ? "true" : undefined}
              data-thread-id={thread.id}
              onClick={() => sel.focus(thread.id)}
              className={cn(
                "flex min-h-touch flex-col justify-center gap-1 border-l-2 px-3 py-2 transition-colors duration-80 ease-snap hover:bg-surface-raised focus-visible:bg-surface-raised",
                thread.id === active ? "glow-focus border-accent bg-surface-raised" : "border-transparent",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="flex shrink-0 gap-1">
                  {thread.accountIds.map((id) => <AccountSquare key={id} color={accountColors[id]} />)}
                </span>
                <span className={cn("min-w-0 truncate", thread.unseen ? "font-medium text-text" : "text-text-muted")}>{thread.sender}</span>
              </span>
              <span className="truncate pl-4 text-11 text-text-muted">{thread.subject}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
