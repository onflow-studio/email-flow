"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { useThreadActions } from "./actions/actions";
import { AiNote } from "./actions/ai-note";
import { ActionBar } from "./actions/action-bar";
import { BucketBadge } from "./actions/bucket-badge";
import { AccountSquare } from "./account-square";
import { rememberAccount } from "./compose/last-account";
import { useKeys } from "./keys/keymap";
import { displayName, MessageContent } from "./message";
import { useMailSelection } from "./selection";
import { ThreadTimeline } from "./thread-timeline";
import { shortTime, Time } from "./time";

const SCROLL_STEP = 64;

export function ReadingPane({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const { run } = useThreadActions();
  const single = thread.messages.length === 1;
  const triage = sel.view === "triage" && thread.bucket === "triage";
  const judgedIds = new Set(thread.judged.map((sender) => sender.id));
  const judgedMessage = triage
    ? (thread.messages.findLast((m) => m.isInbound && !!m.sender && judgedIds.has(m.sender.id))
      ?? thread.messages.findLast((m) => m.isInbound)
      ?? thread.messages.at(-1))
    : null;
  const previousMessage = judgedMessage ? thread.messages[thread.messages.findIndex((m) => m.id === judgedMessage.id) - 1] : null;
  const priorMessages = judgedMessage ? thread.messages.filter((m) => m.id !== judgedMessage.id) : [];

  // A single message has no timeline cursor: arrows scroll the pane.
  const articleRef = useRef<HTMLElement>(null);
  const scroll = (dir: 1 | -1) => articleRef.current?.closest("main")?.scrollBy({ top: dir * SCROLL_STEP });
  const reading = () => sel.pane === "reading" && (single || triage);
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

      {triage ? (
        <header className="flex flex-col gap-3 border-b border-border pb-4">
          <p className="text-11 text-text-muted">decide who reaches your inbox</p>
          <div className="flex flex-col gap-1">
            <span className="text-11 text-text-muted">{thread.judged.length === 1 ? "sender under review" : "senders under review"}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-15 font-medium text-text">
              {thread.judged.map((sender) => (
                <span key={sender.id} className="min-w-0">
                  {sender.name || sender.email}
                  {sender.name ? <span className="ml-2 text-12 font-normal text-text-muted">&lt;{sender.email}&gt;</span> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-11 text-text-muted">
            <span>received by</span>
            {thread.accounts.map((account) => (
              <span key={account.id} className="flex items-center gap-2">
                <AccountSquare color={account.color} />
                {account.label} &lt;{account.email}&gt;
              </span>
            ))}
            <BucketBadge thread={thread} />
            {thread.needsReply ? <span>needs reply</span> : null}
            {thread.deadlineAt ? <Deadline iso={thread.deadlineAt} /> : null}
          </div>
          <AiNote thread={thread} />
          <Subject subject={thread.subject} />
        </header>
      ) : <header className="flex flex-col gap-2">
        <AiNote thread={thread} />
        <Subject subject={thread.subject} />
        <div className="flex flex-wrap items-center gap-2 text-11 text-text-muted">
          {thread.accounts.map((a) => (
            <span key={a.id} className="flex items-center gap-2">
              <AccountSquare color={a.color} />
              {a.label}
            </span>
          ))}
          <BucketBadge thread={thread} />
          {thread.bucket === "triage" && thread.judged.length ? (
            // Who let in and keep out decide on.
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span aria-hidden className="text-text-dim">
                ·
              </span>
              {thread.judged.map((s, i) => (
                <span key={s.id} className="flex min-w-0 whitespace-pre">
                  {s.name ? <span className="max-w-judged truncate text-text">{s.name}</span> : null}
                  <span className="truncate">{`${s.name ? "\u00a0" : ""}<${s.email}>${i < thread.judged.length - 1 ? "," : ""}`}</span>
                </span>
              ))}
            </span>
          ) : null}
          {single ? null : <span>{thread.messages.length} messages</span>}
          {thread.work ? <span>in work</span> : null}
          {thread.trashed ? <span className="text-danger">in trash</span> : null}
          {thread.snoozedUntil || thread.needsReply || thread.deadlineAt ? (
            // Snooze state sits apart at the right, in the snooze colour.
            <span className="ml-auto flex items-center gap-2">
              {thread.snoozedUntil ? (
                <span className="text-warning">
                  snoozed until <Time iso={thread.snoozedUntil} format="full" />
                </span>
              ) : null}
              {thread.needsReply ? <span className="text-text">needs reply</span> : null}
              {thread.deadlineAt ? <Deadline iso={thread.deadlineAt} /> : null}
            </span>
          ) : null}
        </div>
      </header>}

      {judgedMessage ? (
        <>
          <MessageContent
            message={judgedMessage}
            quoteLabel={previousMessage ? `··· quoted text from ${displayName(previousMessage).toLowerCase()}, ${shortTime(previousMessage.date)}` : null}
          />
          {priorMessages.length ? <PriorHistory messages={priorMessages} /> : null}
        </>
      ) : single ? (
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

function PriorHistory({ messages }: { messages: ThreadDetail["messages"] }) {
  const [open, setOpen] = useState(false);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  return (
    <section className="border-t border-border pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-touch w-full items-center text-left text-12 text-text-muted transition-colors duration-80 ease-snap hover:text-text focus-visible:text-text md:h-row"
      >
        {open ? "hide" : "show"} prior thread history ({messages.length} {messages.length === 1 ? "message" : "messages"})
      </button>
      {open ? (
        <ol className="flex flex-col gap-1 pt-2">
          {messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                aria-expanded={openMessage === message.id}
                onClick={() => setOpenMessage(openMessage === message.id ? null : message.id)}
                className="flex h-touch w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-12 text-text-muted transition-colors duration-80 ease-snap hover:bg-surface-raised focus-visible:bg-surface-raised md:h-row"
              >
                <span className="shrink-0 text-text">{displayName(message)}</span>
                <span className="min-w-0 flex-1 truncate">{message.snippet}</span>
                <Time iso={message.date} className="shrink-0 text-11" />
              </button>
              {openMessage === message.id ? <div className="p-3"><MessageContent message={message} /></div> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
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

/**
 * The thread subject, at most two lines with the whole of it on hover. A leading `[owner/repo]`
 * style tag moves to a quiet line above, since the list's group label already names it.
 */
function Subject({ subject }: { subject: string }) {
  const m = subject.match(/^\s*\[([^\]]{2,80})\]\s*(.+)$/);
  return (
    <div className="flex flex-col gap-1">
      {m ? <span className="text-12 text-text-muted">{m[1]}</span> : null}
      <h1 title={subject} className="line-clamp-2 text-20 font-semibold text-text">
        {m ? m[2] : subject}
      </h1>
    </div>
  );
}
