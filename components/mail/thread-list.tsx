"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ThreadListItem } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { AccountSquare } from "./account-square";
import { useMailSelection } from "./selection";
import { fullTime, Time } from "./time";
import { UnreadDot } from "./unread-dot";
import { mailHref } from "./views";

export function ThreadList({
  threads,
  accountColors,
  accountNames,
  emptyLabel,
}: {
  threads: ThreadListItem[];
  accountColors: Record<string, string>;
  accountNames: Record<string, string>;
  emptyLabel: string;
}) {
  const sel = useMailSelection();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!sel.focusedId) return;
    listRef.current
      ?.querySelector(`[data-thread-id="${sel.focusedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel.focusedId]);

  if (!threads.length) {
    return <p className="p-3 text-text-muted">{emptyLabel}</p>;
  }

  const byId = new Map(threads.map((t) => [t.id, t]));
  const ordered = sel.threadIds.flatMap((id) => byId.get(id) ?? []);
  const work = sel.view === "work";
  // Work keeps its own order (deadlines, then queue), so it has no unseen and seen groups.
  const unseen = work ? 0 : threads.filter((t) => t.unseen).length;
  // Group labels only hold while rows sit in server order (unseen first).
  const grouped = ordered.every((t, i) => t.id === threads[i]?.id);
  const firstUnseen = grouped ? 0 : -1;
  const firstSeen = grouped ? ordered.findIndex((t) => !t.unseen) : -1;

  return (
    <ul ref={listRef} aria-label="threads" className="flex flex-col py-1">
      {ordered.map((t, i) => (
        <li key={t.id}>
          {i === firstUnseen && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
          {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
          <ThreadRow
            thread={t}
            accountColors={t.accountIds.map((id) => accountColors[id])}
            accountNames={t.accountIds.map((id) => accountNames[id] ?? "unknown account")}
            focused={t.id === sel.focusedId}
            open={t.id === sel.openId}
            href={mailHref(sel.view, { threadId: t.id })}
            onSelect={() => sel.focus(t.id)}
            showSnooze={sel.view === "snoozed"}
            work={work}
          />
        </li>
      ))}
    </ul>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-11 text-text-dim">{children}</div>;
}

function ThreadRow({
  thread: t,
  accountColors,
  accountNames,
  focused,
  open,
  href,
  onSelect,
  showSnooze,
  work,
}: {
  thread: ThreadListItem;
  /** One per account the conversation reached: twins show every square. */
  accountColors: (string | undefined)[];
  accountNames: string[];
  focused: boolean;
  open: boolean;
  href: string;
  onSelect: () => void;
  showSnooze: boolean;
  /** Work rows show the deadline and needs reply, and mark an unread reply with the dot. */
  work: boolean;
}) {
  const [now] = useState(() => Date.now());
  const overdue = !!t.deadlineAt && new Date(t.deadlineAt).getTime() < now;
  const status = [t.resurfaced && "back", t.needsReply && "needs reply", overdue && "overdue", work && t.deadlineAt && !overdue && `due ${fullTime(t.deadlineAt)}`].filter(Boolean);
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={open ? "page" : undefined}
      data-thread-id={t.id}
      onClick={onSelect}
      className={cn(
        "flex min-h-mail-row min-w-0 flex-col justify-center gap-1 border-l-2 pr-3 pl-2 leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised",
        focused
          ? "glow-focus border-accent bg-surface-raised"
          : "border-transparent hover:bg-surface-raised",
      )}
    >
      <span className="sr-only">{accountNames.join(", ")}; {t.unseen ? "unseen" : "seen"}{status.length ? `; ${status.join(", ")}` : ""}; </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span aria-hidden className="flex shrink-0 gap-1">
          {accountColors.map((color, i) => <AccountSquare key={i} color={color} />)}
        </span>
        {t.unseen ? <UnreadDot /> : null}
        <span className={cn("min-w-0 flex-1 truncate", t.unseen ? "font-medium text-text" : "text-text-muted")}>{t.sender}</span>
        {t.messageCount > 1 ? <span className="shrink-0 text-11 text-text-dim">{t.messageCount}</span> : null}
        {t.resurfaced ? <span aria-hidden><Badge>back</Badge></span> : null}
        <Time iso={showSnooze && t.snoozedUntil ? t.snoozedUntil : t.lastMessageAt} className="shrink-0 text-11 tabular-nums text-text-muted" />
      </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span className={t.unseen ? "font-medium text-text" : "text-text-muted"}>{t.subject}</span>
          {t.summary || t.snippet ? <span className="text-text-muted"> · {t.summary ?? t.snippet}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          {t.needsReply ? <Badge>reply</Badge> : null}
          {overdue ? <Badge className="text-warning">overdue</Badge> : work && t.deadlineAt ? <Badge>due <Time iso={t.deadlineAt} /></Badge> : null}
        </span>
      </span>
    </Link>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-sm bg-surface-raised px-1 text-11 text-text-muted", className)}>{children}</span>
  );
}
