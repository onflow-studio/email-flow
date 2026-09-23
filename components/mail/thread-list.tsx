"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ThreadListItem } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { useMailSelection } from "./selection";
import { Time } from "./time";
import { mailHref } from "./views";

export function ThreadList({
  threads,
  accountColors,
  emptyLabel,
}: {
  threads: ThreadListItem[];
  accountColors: Record<string, string>;
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
  // Pinned rows sit above the groups, marked by their badge.
  const unseen = threads.filter((t) => t.unseen && !t.pinned).length;
  // Group labels only hold while rows sit in server order (pinned, then unseen first).
  const grouped = ordered.every((t, i) => t.id === threads[i]?.id);
  const firstUnseen = grouped ? ordered.findIndex((t) => !t.pinned) : -1;
  const firstSeen = grouped ? ordered.findIndex((t) => !t.pinned && !t.unseen) : -1;

  return (
    <ul ref={listRef} role="listbox" aria-label="threads" className="flex flex-col py-1">
      {ordered.map((t, i) => (
        <li key={t.id} role="presentation">
          {i === firstUnseen && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
          {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
          <ThreadRow
            thread={t}
            accountColor={accountColors[t.accountId]}
            focused={t.id === sel.focusedId}
            open={t.id === sel.openId}
            href={mailHref(sel.view, { threadId: t.id, account: sel.account })}
            onSelect={() => sel.focus(t.id)}
            showSnooze={sel.view === "snoozed"}
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
  accountColor,
  focused,
  open,
  href,
  onSelect,
  showSnooze,
}: {
  thread: ThreadListItem;
  accountColor?: string;
  focused: boolean;
  open: boolean;
  href: string;
  onSelect: () => void;
  showSnooze: boolean;
}) {
  const [now] = useState(() => Date.now());
  const overdue = !!t.deadlineAt && new Date(t.deadlineAt).getTime() < now;
  return (
    <Link
      href={href}
      scroll={false}
      role="option"
      aria-selected={focused}
      aria-current={open ? "true" : undefined}
      data-thread-id={t.id}
      onClick={onSelect}
      className={cn(
        "flex h-touch items-center gap-2 border-l-2 pr-3 pl-2 transition-colors duration-80 ease-snap md:h-row",
        focused
          ? "glow-focus border-accent bg-surface-raised"
          : "border-transparent hover:bg-surface-raised",
      )}
    >
      <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: accountColor ?? "var(--text-dim)" }} />
      <span
        className={cn(
          "w-sender shrink-0 truncate",
          t.unseen ? "font-medium text-text" : "text-text-muted",
        )}
      >
        {t.sender}
      </span>
      {t.messageCount > 1 ? <span className="shrink-0 text-11 text-text-dim">{t.messageCount}</span> : null}
      <span className="min-w-0 flex-1 truncate">
        <span className={t.unseen ? "font-medium text-text" : "text-text-dim"}>{t.subject}</span>
        {t.summary || t.snippet ? (
          <span className={t.unseen ? "text-text-muted" : "text-text-dim"}> {t.summary ?? t.snippet}</span>
        ) : null}
      </span>
      {t.resurfaced ? <Badge>back</Badge> : null}
      {overdue ? <Badge className="text-warning">overdue</Badge> : t.needsReply ? <Badge>reply</Badge> : null}
      {t.pinned ? <Badge>pinned</Badge> : null}
      {showSnooze && t.snoozedUntil ? (
        <Time iso={t.snoozedUntil} className="shrink-0 text-11 text-text-muted" />
      ) : (
        <Time iso={t.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
      )}
    </Link>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-sm bg-surface-raised px-1 text-11 text-text-muted", className)}>{children}</span>
  );
}
