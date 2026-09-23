"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { useThreadActions } from "./actions/actions";
import { AiNote } from "./actions/ai-note";
import { ActionBar } from "./actions/action-bar";
import { BucketBadge } from "./actions/bucket-badge";
import { rememberAccount } from "./compose/last-account";
import { useKeys } from "./keys/keymap";
import { MessageContent } from "./message";
import { useMailSelection } from "./selection";
import { ThreadTimeline } from "./thread-timeline";
import { Time } from "./time";

const SCROLL_STEP = 64;

export function ReadingPane({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const { run } = useThreadActions();
  const single = thread.messages.length === 1;

  // A single message has no timeline cursor: arrows scroll the pane.
  const articleRef = useRef<HTMLElement>(null);
  const scroll = (dir: 1 | -1) => articleRef.current?.closest("main")?.scrollBy({ top: dir * SCROLL_STEP });
  const reading = () => sel.pane === "reading" && single;
  useKeys([
    { keys: "arrowdown", when: reading, run: () => scroll(1) },
    { keys: "arrowup", when: reading, run: () => scroll(-1) },
  ]);

  // Reading a thread makes its account the default for new mail.
  useEffect(() => {
    rememberAccount(thread.account.id);
  }, [thread.account.id]);

  return (
    <article ref={articleRef} className="flex min-h-full w-full flex-col gap-4 px-3 pt-8 md:px-6 md:pb-4">
      <div className="sticky top-0 z-10 -mx-3 -mt-8 flex h-touch shrink-0 items-center border-b border-border bg-surface px-1 md:hidden">
        <button type="button" onClick={sel.close} className="flex h-touch items-center gap-2 px-2 text-text-muted">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
          back
        </button>
        {thread.trashed ? (
          <button type="button" onClick={() => void run({ type: "restore" }, [thread.id])} className="ml-auto flex h-touch items-center px-2 text-text-muted">
            restore
          </button>
        ) : (
          <button type="button" onClick={() => void run({ type: "trash" }, [thread.id])} className="ml-auto flex h-touch items-center px-2 text-danger">
            delete
          </button>
        )}
      </div>

      <header className="flex flex-col gap-2">
        <AiNote thread={thread} />
        <h1 className="text-20 font-semibold text-text">{thread.subject}</h1>
        <div className="flex flex-wrap items-center gap-2 text-11 text-text-muted">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-2" style={{ backgroundColor: thread.account.color }} />
            {thread.account.label}
          </span>
          <BucketBadge thread={thread} />
          {single ? null : <span>{thread.messages.length} messages</span>}
          {thread.snoozedUntil ? (
            <span>
              snoozed until <Time iso={thread.snoozedUntil} format="full" />
            </span>
          ) : null}
          {thread.needsReply ? <span className="text-text">needs reply</span> : null}
          {thread.deadlineAt ? <Deadline iso={thread.deadlineAt} /> : null}
          {thread.pinned ? <span>pinned</span> : null}
          {thread.trashed ? <span className="text-danger">in trash</span> : null}
        </div>
      </header>

      {single ? (
        // One message: no timeline, no card. It sits on the pane, aligned with the subject.
        <MessageContent message={thread.messages[0]} />
      ) : (
        <ThreadTimeline messages={thread.messages} />
      )}

      {/* Sticks to the pane bottom, 16px up on desktop, docked flat on phone. Clearance under the last
          message is the gap (16) + the bar (40) + the bottom offset (16): pb-action's 72. */}
      <div className="pointer-events-none sticky bottom-0 z-10 -mx-3 mt-auto flex justify-center md:bottom-4 md:mx-0">
        <ActionBar thread={thread} />
      </div>
    </article>
  );
}

function Deadline({ iso }: { iso: string }) {
  const [now] = useState(() => Date.now());
  const late = new Date(iso).getTime() < now;
  return (
    <span className={late ? "text-warning" : undefined}>
      {late ? "overdue since" : "due"} <Time iso={iso} format="full" />
    </span>
  );
}
