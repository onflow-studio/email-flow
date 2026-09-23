"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

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

  const unseen = threads.filter((t) => t.unseen).length;
  const firstSeen = threads.findIndex((t) => !t.unseen);

  return (
    <ul ref={listRef} role="listbox" aria-label="threads" className="flex flex-col py-1">
      {threads.map((t, i) => (
        <li key={t.id} role="presentation">
          {i === 0 && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
          {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
          <ThreadRow
            thread={t}
            accountColor={accountColors[t.accountId]}
            focused={t.id === sel.focusedId}
            open={t.id === sel.openId}
            href={mailHref(sel.view, { threadId: t.id, account: sel.account })}
            onSelect={() => sel.focus(t.id)}
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
}: {
  thread: ThreadListItem;
  accountColor?: string;
  focused: boolean;
  open: boolean;
  href: string;
  onSelect: () => void;
}) {
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
      <span aria-hidden className="h-3 w-0.5 shrink-0" style={{ backgroundColor: accountColor ?? "var(--text-dim)" }} />
      <span
        className={cn(
          "w-28 shrink-0 truncate",
          t.unseen ? "font-medium text-text" : "text-text-muted",
        )}
      >
        {t.sender}
      </span>
      {t.messageCount > 1 ? <span className="shrink-0 text-11 text-text-dim">{t.messageCount}</span> : null}
      <span className="min-w-0 flex-1 truncate">
        <span className={t.unseen ? "font-medium text-text" : "text-text-dim"}>{t.subject}</span>
        {t.snippet ? <span className={t.unseen ? "text-text-muted" : "text-text-dim"}> {t.snippet}</span> : null}
      </span>
      <Time iso={t.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
    </Link>
  );
}
