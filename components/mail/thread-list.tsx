"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ThreadListItem } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { useListScroll, useMailSelection } from "./selection";
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
  const { listScroll, setListScroll } = useListScroll();

  // Back where it was before the page remounted, before the focused row is brought into view.
  useLayoutEffect(() => {
    const scroller = listRef.current?.parentElement;
    if (!scroller) return;
    const top = listScroll(sel.view);
    if (top !== undefined) scroller.scrollTop = top;
    const save = () => setListScroll(sel.view, scroller.scrollTop);
    scroller.addEventListener("scroll", save, { passive: true });
    return () => scroller.removeEventListener("scroll", save);
  }, [sel.view, listScroll, setListScroll]);

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
  const selected = new Set(sel.selectedIds);
  const picking = selected.size > 0;
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
        <li key={t.id} className="relative">
          {i === firstUnseen && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
          {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
          <ThreadRow
            thread={t}
            accountColors={t.accountIds.map((id) => accountColors[id])}
            accountNames={t.accountIds.map((id) => accountNames[id] ?? "unknown account")}
            focused={t.id === sel.focusedId}
            selected={selected.has(t.id)}
            open={t.id === sel.openId}
            href={mailHref(sel.view, { threadId: t.id })}
            onSelect={() => {
              sel.endRange();
              sel.focus(t.id);
            }}
            showSnooze={sel.view === "snoozed"}
            work={work}
          />
          {picking ? <PickBox checked={selected.has(t.id)} label={t.subject} onToggle={() => sel.toggleSelected(t.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Sits in the row's left gutter, beside the link, so picking never opens the thread. */
function PickBox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`select ${label}`}
      onClick={onToggle}
      className="group absolute inset-y-0 left-0 flex w-6 items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border transition-colors duration-80 ease-snap group-focus-visible:border-accent",
          checked ? "border-accent bg-accent text-bg" : "border-text-muted bg-bg group-hover:border-text",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
      </span>
    </button>
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
  selected,
  open,
  href,
  onSelect,
  showSnooze,
  work,
}: {
  thread: ThreadListItem;
  /** One per account the conversation reached: twins show each name by the date. */
  accountColors: (string | undefined)[];
  accountNames: string[];
  focused: boolean;
  /** In the shift+arrows range. */
  selected: boolean;
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
      data-selected={selected || undefined}
      data-thread-id={t.id}
      onClick={onSelect}
      className={cn(
        "flex min-h-mail-row min-w-0 flex-col justify-center gap-1 border-l-2 pr-3 pl-6 leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised",
        focused
          ? "glow-focus border-accent bg-surface-raised"
          : selected
            ? "border-transparent bg-accent-dim/40"
            : "border-transparent hover:bg-surface-raised",
      )}
    >
      <span className="sr-only">{selected ? "selected; " : ""}{accountNames.join(", ")}; {t.unseen ? "unseen" : "seen"}{status.length ? `; ${status.join(", ")}` : ""}; </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        {t.unseen ? <UnreadDot /> : null}
        <span className={cn("min-w-0 flex-1 truncate font-medium", t.unseen ? "text-text" : "text-text-muted")}>{t.sender}</span>
        {t.messageCount > 1 ? <span className="shrink-0 text-11 text-text-dim">{t.messageCount}</span> : null}
        {t.resurfaced ? <span aria-hidden><Badge>back</Badge></span> : null}
        <span aria-hidden title={accountNames.join(", ")} className="flex max-w-[35%] min-w-0 shrink-0 gap-1 overflow-hidden whitespace-nowrap text-11">
          {accountNames.map((name, i) => (
            <span key={i} className="shrink-0" style={{ color: accountColors[i] ? `color-mix(in srgb, ${accountColors[i]} 40%, var(--text-muted))` : "var(--text-muted)" }}>
              {name}
            </span>
          ))}
        </span>
        <Time iso={showSnooze && t.snoozedUntil ? t.snoozedUntil : t.lastMessageAt} className="shrink-0 text-11 tabular-nums text-text-muted" />
      </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span className={t.unseen ? "text-text" : "text-text-muted"}>{t.subject}</span>
          {t.summary || t.snippet ? <span className={t.unseen ? "text-text-muted" : "text-text-dim"}> · {t.summary ?? t.snippet}</span> : null}
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
