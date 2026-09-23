"use client";

import { ArrowLeft, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import { markSeen } from "@/app/(mail)/thread-actions";
import type { Address } from "@/lib/db/schema";
import { attachmentUrl, opensInline } from "@/lib/mail/remote";
import { cn } from "@/lib/utils";

import { useThreadActions } from "./actions/actions";
import { AiNote } from "./actions/ai-note";
import { ActionToolbar } from "./actions/toolbar";
import { ReplyBar } from "./compose/reply-bar";
import { EmailFrame } from "./email-frame";
import { useKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { Time } from "./time";

const BUCKET_LABELS: Record<ThreadDetail["bucket"], string> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper trail",
  triage: "triage",
  out: "out",
};

type MessageItem = ThreadDetail["messages"][number];

const SCROLL_STEP = 64;

export function ReadingPane({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const { run } = useThreadActions();
  const lastId = thread.messages.at(-1)?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(lastId ? [lastId] : []));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Arrow keys in the reading pane: scroll through the message under the cursor, then step to the next one.
  const articleRef = useRef<HTMLElement>(null);
  const [cursor, setCursor] = useState(thread.messages.length - 1);
  const reading = () => sel.pane === "reading";
  const moveCursor = (dir: 1 | -1) => {
    const scroller = articleRef.current?.closest("main");
    const items = articleRef.current?.querySelectorAll<HTMLElement>("[data-message]");
    const item = items?.[cursor];
    if (!scroller || !items || !item) return;
    const view = scroller.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    const more = dir === 1 ? box.bottom > view.bottom : box.top < view.top;
    const next = items[cursor + dir];
    if (more || !next) {
      scroller.scrollBy({ top: dir * SCROLL_STEP });
      return;
    }
    setCursor(cursor + dir);
    next.scrollIntoView({ block: "nearest" });
  };
  useKeys([
    { keys: "arrowdown", when: reading, run: () => moveCursor(1) },
    { keys: "arrowup", when: reading, run: () => moveCursor(-1) },
    {
      keys: "enter",
      label: "expand message",
      group: "panes",
      // A focused button or link keeps its own enter.
      when: () => reading() && !!thread.messages[cursor] && !document.activeElement?.closest("button, a"),
      run: () => toggle(thread.messages[cursor].id),
    },
  ]);

  // Opening marks seen and mirrors read state to Gmail.
  useEffect(() => {
    markSeen(thread.id).catch(() => {});
  }, [thread.id]);

  return (
    <article ref={articleRef} className="flex w-full flex-col gap-4 px-3 pt-8 pb-8 md:px-6">
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
          <span className="rounded-sm bg-accent-dim px-1 text-text">{BUCKET_LABELS[thread.bucket]}</span>
          <span>
            {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}
          </span>
          {thread.snoozedUntil ? (
            <span>
              snoozed until <Time iso={thread.snoozedUntil} format="full" />
            </span>
          ) : null}
          {thread.needsReply ? <span className="text-text">needs reply</span> : null}
          {thread.deadlineAt ? <Deadline iso={thread.deadlineAt} /> : null}
          {thread.setAside ? <span>set aside</span> : null}
          {thread.trashed ? <span className="text-danger">in trash</span> : null}
        </div>
        <ActionToolbar thread={thread} />
      </header>

      <ol className="flex flex-col gap-2">
        {thread.messages.map((m, i) => (
          <li
            key={m.id}
            data-message
            onPointerDown={() => setCursor(i)}
            className={cn(
              "rounded-sm border border-border bg-surface transition-colors duration-80 ease-snap",
              sel.pane === "reading" && i === cursor && thread.messages.length > 1 && "md:border-accent-dim",
            )}
          >
            {expanded.has(m.id) ? (
              <ExpandedMessage message={m} onCollapse={() => toggle(m.id)} />
            ) : (
              <button
                type="button"
                onClick={() => toggle(m.id)}
                className="flex h-touch w-full items-center gap-2 px-3 text-left md:h-row transition-colors duration-80 ease-snap hover:bg-surface-raised"
              >
                <span className="w-sender shrink-0 truncate text-text-muted">{displayName(m)}</span>
                <span className="min-w-0 flex-1 truncate text-text-dim">{m.snippet}</span>
                {m.attachments.length ? <Paperclip aria-hidden className="size-3 text-text-dim" /> : null}
                <Time iso={m.date} className="shrink-0 text-11 text-text-muted" />
              </button>
            )}
          </li>
        ))}
      </ol>

      <ReplyBar threadId={thread.id} accountId={thread.account.id} />
    </article>
  );
}

function ExpandedMessage({
  message: m,
  onCollapse,
}: {
  message: MessageItem;
  onCollapse: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <button type="button" onClick={onCollapse} className="flex items-start gap-2 text-left">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">
            <span className={cn("font-medium", m.isInbound ? "text-text" : "text-text-muted")}>{displayName(m)}</span>
            {m.fromName ? <span className="text-text-muted"> {m.fromEmail}</span> : null}
          </span>
          <span className="truncate text-11 text-text-muted">
            to {formatAddresses(m.to)}
            {m.cc.length ? `, cc ${formatAddresses(m.cc)}` : ""}
          </span>
        </div>
        <Time iso={m.date} format="full" className="shrink-0 text-11 text-text-muted" />
      </button>

      {m.htmlSanitized ? (
        <EmailFrame html={m.htmlSanitized} imagesAllowed={m.imagesAllowed} senderId={m.senderId} />
      ) : (
        <div className="leading-prose whitespace-pre-wrap text-text">{m.text}</div>
      )}

      {m.attachments.length ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {m.attachments.map((a) => {
            const inline = opensInline(a.mimeType);
            return (
              <li key={a.id}>
                <a
                  href={attachmentUrl(a.id, { inline })}
                  {...(inline ? { target: "_blank", rel: "noreferrer" } : { download: a.filename })}
                  title={inline ? "open" : "download"}
                  className="flex h-touch items-center gap-2 rounded-sm px-1 text-text-muted md:h-row transition-colors duration-80 ease-snap hover:bg-surface-raised hover:text-text"
                >
                  <Paperclip aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate text-text">{a.filename}</span>
                  <span className="shrink-0 text-11">{formatSize(a.size)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
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

function displayName(m: MessageItem) {
  return m.isInbound ? m.fromName || m.fromEmail : "me";
}

function formatAddresses(list: Address[]) {
  if (!list.length) return "undisclosed";
  return list.map((a) => a.name || a.email).join(", ");
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} mb`;
}
