"use client";

import { Check, ChevronDown, ChevronRight } from "lucide-react";
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
  const ordered = sel.allIds.flatMap((id) => byId.get(id) ?? []);
  const work = sel.view === "work";
  // Inbox and Work set rows by who wrote: people get two lines, machines one. The other buckets are
  // nearly all machine mail, where the subject is the content, so they keep two lines.
  const byKind = sel.view === "inbox" || work;

  // Rows come in blocks: a thread alone, or a group of machine mail from one source.
  type Block = { key: string; cluster: { key: string; label: string } | null; threads: ThreadListItem[] };
  const blocks: Block[] = [];
  for (const t of ordered) {
    const last = blocks.at(-1);
    if (t.cluster && last?.cluster?.key === t.cluster.key) last.threads.push(t);
    else blocks.push({ key: t.cluster ? `c:${t.cluster.key}` : t.id, cluster: t.cluster, threads: [t] });
  }
  const blockUnseen = (b: Block) => b.threads.some((t) => t.unseen);
  // Work keeps its own order (deadlines, then queue), so it has no unseen and seen groups.
  const unseen = work ? 0 : threads.filter((t) => t.unseen).length;
  // Group labels only hold while rows sit in server order (unseen first).
  const grouped = ordered.every((t, i) => t.id === threads[i]?.id);
  const firstUnseen = grouped ? 0 : -1;
  const firstSeen = grouped ? blocks.findIndex((b) => !blockUnseen(b)) : -1;

  const row = (t: ThreadListItem, nested = false) => (
    // A hairline under every thread, so each one reads as its own box where it starts and ends.
    <li key={t.id} className="relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
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
        byKind={byKind}
        nested={nested}
      />
      {picking ? <PickBox checked={selected.has(t.id)} label={t.subject} onToggle={() => sel.toggleSelected(t.id)} /> : null}
    </li>
  );

  return (
    <ul ref={listRef} aria-label="threads" className="@container flex flex-col py-1">
      {blocks.map((b, i) => {
        const labels = (
          <>
            {i === firstUnseen && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
            {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
          </>
        );
        if (!b.cluster) {
          return (
            <li key={b.key} className="flex flex-col">
              {labels}
              <ul>{row(b.threads[0])}</ul>
            </li>
          );
        }
        const head = b.threads[0];
        const collapsed = sel.isCollapsed(b.cluster.key);
        const accountIds = [...new Set(b.threads.flatMap((t) => t.accountIds))];
        return (
          <li key={b.key} className="flex flex-col">
            {labels}
            <ClusterRow
              label={b.cluster.label}
              threads={b.threads}
              collapsed={collapsed}
              accountColors={accountIds.map((id) => accountColors[id])}
              accountNames={accountIds.map((id) => accountNames[id] ?? "unknown account")}
              focused={collapsed && head.id === sel.focusedId}
              open={collapsed && head.id === sel.openId}
              onToggle={() => {
                sel.endRange();
                sel.focus(head.id);
                sel.toggleCluster(b.cluster!.key);
              }}
            />
            {collapsed ? null : <ul className="relative flex flex-col before:absolute before:inset-y-0 before:left-4 before:w-px before:bg-border">{b.threads.map((t) => row(t, true))}</ul>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A group of machine mail from one source. Collapsed it is one line standing for all of them, the
 * keyboard's stop, with a deck edge under it; expanded it is a slim header over its threads.
 */
function ClusterRow({
  label,
  threads,
  collapsed,
  accountColors,
  accountNames,
  focused,
  open,
  onToggle,
}: {
  label: string;
  threads: ThreadListItem[];
  collapsed: boolean;
  accountColors: (string | undefined)[];
  accountNames: string[];
  focused: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const head = threads[0];
  const fresh = threads.filter((t) => t.unseen).length;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const names = (
    <span aria-hidden title={accountNames.join(", ")} className="flex max-w-[35%] min-w-0 shrink-0 gap-1 overflow-hidden whitespace-nowrap text-11">
      {accountNames.map((name, i) => (
        <span key={i} className="shrink-0" style={{ color: accountColors[i] ? `color-mix(in srgb, ${accountColors[i]} 40%, var(--text-muted))` : "var(--text-muted)" }}>
          {name}
        </span>
      ))}
    </span>
  );

  if (!collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="flex h-row min-w-0 items-center gap-2 border-l-2 border-transparent pr-3 pl-6 text-left text-11 text-text-muted transition-colors duration-80 ease-snap hover:bg-surface-raised hover:text-text focus-visible:border-accent focus-visible:bg-surface-raised"
      >
        <Chevron aria-hidden className="-ml-4 size-3 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{threads.length}</span>
      </button>
    );
  }

  return (
    <div className="relative pb-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-current={open ? "page" : undefined}
        data-thread-id={head.id}
        title={head.subject}
        className={cn(
          "relative z-10 flex h-touch w-full min-w-0 items-center gap-2 border-l-2 bg-surface pr-3 pl-6 text-left leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised md:h-row",
          focused ? "border-accent bg-surface-raised" : "border-transparent hover:bg-surface-raised",
        )}
      >
        <span className="sr-only">group of {threads.length} threads, {fresh} unseen, newest {head.subject}; </span>
        <Chevron aria-hidden className="-ml-4 size-3 shrink-0 text-text-muted" strokeWidth={1.5} />
        {fresh ? <UnreadDot /> : null}
        <span className={cn("max-w-[40%] min-w-0 shrink-0 truncate font-medium", fresh ? "text-text" : "text-text-muted")}>{label}</span>
        <span aria-hidden>
          <Badge className={fresh ? "text-text" : undefined}>{fresh ? `${fresh} new · ${threads.length}` : `${threads.length} threads`}</Badge>
        </span>
        <span aria-hidden className="hidden min-w-0 flex-1 truncate text-text-dim @min-[320px]:block">{head.subject}</span>
        <span className="flex-1 @min-[320px]:hidden" />
        {names}
        <Time iso={head.lastMessageAt} className="shrink-0 text-11 tabular-nums text-text-muted" />
      </button>
      {/* The deck: two edges peeking under the row, one per thread it stands on. */}
      <span aria-hidden className="absolute inset-x-3 bottom-[3px] h-px bg-text-dim/70" />
      <span aria-hidden className="absolute inset-x-6 bottom-0 h-px bg-text-dim/40" />
    </div>
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
  byKind,
  nested = false,
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
  /** Rows set by who wrote: people two lines, machines one, whose turn it is on the sender. */
  byKind: boolean;
  /** Inside an open group: indented past the group's guide line. */
  nested?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const overdue = !!t.deadlineAt && new Date(t.deadlineAt).getTime() < now;
  const status = [t.resurfaced && "back", t.needsReply && "needs reply", overdue && "overdue", work && t.deadlineAt && !overdue && `due ${fullTime(t.deadlineAt)}`].filter(Boolean);
  const machine = byKind && t.kind === "machine";
  const person = byKind && t.kind === "person";
  // The user wrote last: the next move is theirs, so the row steps back.
  const theirTurn = person && t.lastFromMe && !t.unseen;
  const others = theirTurn ? t.sender.split(", ").filter((n) => n !== "me").join(", ") : t.sender;
  const today = new Date(t.lastMessageAt).toDateString() === new Date(now).toDateString();
  const lit = t.unseen || (person && !theirTurn);
  const time = showSnooze && t.snoozedUntil ? t.snoozedUntil : t.lastMessageAt;

  const names = (
    <span aria-hidden title={accountNames.join(", ")} className="flex max-w-[35%] min-w-0 shrink-0 gap-1 overflow-hidden whitespace-nowrap text-11">
      {accountNames.map((name, i) => (
        <span key={i} className="shrink-0" style={{ color: accountColors[i] ? `color-mix(in srgb, ${accountColors[i]} 40%, var(--text-muted))` : "var(--text-muted)" }}>
          {name}
        </span>
      ))}
    </span>
  );
  const badges = (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {t.needsReply ? <Badge className="bg-signal/15 text-signal">reply</Badge> : null}
      {overdue ? <Badge className="text-warning">overdue</Badge> : work && t.deadlineAt ? <Badge>due <Time iso={t.deadlineAt} /></Badge> : null}
    </span>
  );
  const label = (
    <span className="sr-only">
      {selected ? "selected; " : ""}
      {byKind ? `${t.kind === "machine" ? "automated" : "person"}; ` : ""}
      {theirTurn ? "you wrote last; " : ""}
      {accountNames.join(", ")}; {t.unseen ? "unseen" : "seen"}
      {status.length ? `; ${status.join(", ")}` : ""};{" "}
    </span>
  );
  const rowClass = cn(
    nested ? "pl-8" : "pl-6",
    "flex min-w-0 border-l-2 pr-3 leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised",
    focused
      ? "border-accent bg-surface-raised"
      : selected
        ? "border-transparent bg-accent-dim/40"
        : "border-transparent hover:bg-surface-raised",
  );

  if (machine) {
    return (
      <Link
        href={href}
        scroll={false}
        aria-current={open ? "page" : undefined}
        data-selected={selected || undefined}
        data-thread-id={t.id}
        onClick={onSelect}
        title={t.summary || t.snippet || t.subject}
        className={cn(rowClass, "h-touch items-center gap-2 md:h-row")}
      >
        {label}
        {t.unseen ? <UnreadDot /> : null}
        <span className={cn("max-w-[40%] min-w-0 shrink-0 truncate", t.unseen ? "text-text" : "text-text-muted")}>{t.sender}</span>
        {t.resurfaced ? <span aria-hidden><Badge>back</Badge></span> : null}
        <span className={cn("hidden min-w-0 flex-1 truncate @min-[320px]:block", t.unseen ? "text-text-muted" : "text-text-dim")}>{t.subject}</span>
        <span className="flex-1 @min-[320px]:hidden" />
        {badges}
        {names}
        <Time iso={time} className="shrink-0 text-11 tabular-nums text-text-muted" />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      scroll={false}
      aria-current={open ? "page" : undefined}
      data-selected={selected || undefined}
      data-thread-id={t.id}
      onClick={onSelect}
      className={cn(rowClass, "min-h-mail-row flex-col justify-center gap-1")}
    >
      {label}
      <span className="flex w-full min-w-0 items-center gap-2">
        {t.unseen ? <UnreadDot /> : null}
        <span className={cn("min-w-0 flex-1 truncate font-medium", lit ? "text-text" : "text-text-muted")}>
          {theirTurn ? <span className="font-normal text-text-dim">{others ? "you, " : "you"}</span> : null}
          {others}
        </span>
        {t.messageCount > 1 ? <span className="shrink-0 text-11 text-text-dim">{t.messageCount}</span> : null}
        {t.resurfaced ? <span aria-hidden><Badge>back</Badge></span> : null}
        {names}
        <Time iso={time} className={cn("shrink-0 text-11 tabular-nums", person && lit && today ? "text-text" : "text-text-muted")} />
      </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span className={t.unseen ? "text-text" : "text-text-muted"}>{t.subject}</span>
          {t.summary || t.snippet ? <span className={t.unseen ? "text-text-muted" : "text-text-dim"}> · {t.summary ?? t.snippet}</span> : null}
        </span>
        {badges}
      </span>
    </Link>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-sm bg-surface-raised px-1 text-11 whitespace-nowrap text-text-muted", className)}>{children}</span>
  );
}
