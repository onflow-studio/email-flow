"use client";

import { Check, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ThreadListItem } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { AccountSquare } from "./account-square";
import { Glider } from "./glider";
import { useListScroll, useMailSelection } from "./selection";
import { fullTime, Time } from "./time";
import { UnreadDot } from "./unread-dot";
import { mailHref } from "./views";

// Thread ids each view has shown this session, so a thread that turns up later can glow as new.
// Undone threads coming back are not new, so ids are only ever added.
const shownInView = new Map<string, Set<string>>();
const AFTERGLOW_MS = 1500;

/**
 * Starts the leave animation on the rows of threads an action takes out of the view, while the
 * server catches up. Returns a function that puts them back when the action fails or keeps them.
 */
export function markLeaving(ids: string[]): () => void {
  const rows = ids.flatMap((id) =>
    [...document.querySelectorAll<HTMLElement>(`[data-thread-id="${id}"]`)].map((el) => el.closest("li") ?? el),
  );
  for (const row of rows) {
    // An explicit height, so the animation can close the gap to zero.
    row.style.height = `${row.offsetHeight}px`;
    row.dataset.leaving = "";
  }
  return () => {
    for (const row of rows) {
      row.style.height = "";
      delete row.dataset.leaving;
    }
  };
}

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
  // The box the focus bar moves in, around the list.
  const glideRef = useRef<HTMLDivElement>(null);
  const { listScroll, setListScroll } = useListScroll();
  const ids = threads.map((t) => t.id).join(",");

  // Threads this view has not shown before this session arrive with an afterglow, on their row or
  // on the collapsed group holding them. The first look at a view only takes note. The glow is CSS
  // on a data attribute, so it never re-renders the list.
  useEffect(() => {
    const current = ids ? ids.split(",") : [];
    const shown = shownInView.get(sel.view);
    if (!shown) {
      shownInView.set(sel.view, new Set(current));
      return;
    }
    const fresh = current.filter((id) => !shown.has(id));
    for (const id of fresh) shown.add(id);
    const rows = fresh.flatMap((id) => {
      const el = glideRef.current?.querySelector<HTMLElement>(`[data-thread-id="${id}"], [data-group-ids~="${id}"]`);
      const row = el?.closest<HTMLElement>("[data-group-ids]") ?? el?.closest("li");
      return row ? [row] : [];
    });
    for (const row of rows) row.dataset.arrived = "";
    const timer = setTimeout(() => rows.forEach((row) => delete row.dataset.arrived), AFTERGLOW_MS);
    return () => clearTimeout(timer);
  }, [ids, sel.view]);

  // Back where it was before the page remounted, before the focused row is brought into view.
  useLayoutEffect(() => {
    const scroller = listRef.current?.parentElement?.parentElement;
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
  // Inbox and Work light a person's sender even once seen; the other buckets are nearly all machine mail.
  const byKind = sel.view === "inbox" || work;
  const accountSlots = Object.keys(accountColors).length;

  // Rows come in blocks: a thread alone, or a group of machine mail from one source.
  type Block = { key: string; cluster: { key: string; label: string } | null; threads: ThreadListItem[] };
  const blocks: Block[] = [];
  for (const t of ordered) {
    const last = blocks.at(-1);
    if (t.cluster && last?.cluster?.key === t.cluster.key) last.threads.push(t);
    else blocks.push({ key: t.cluster ? `c:${t.cluster.key}` : t.id, cluster: t.cluster, threads: [t] });
  }
  const blockUnseen = (b: Block) => b.threads.some((t) => t.unseen);
  // Work keeps its own order (deadlines, then by date), so it has no unseen and seen groups.
  const unseen = work ? 0 : threads.filter((t) => t.unseen).length;
  // Group labels only hold while rows sit in server order (unseen first).
  const grouped = ordered.every((t, i) => t.id === threads[i]?.id);
  const firstUnseen = grouped ? 0 : -1;
  const firstSeen = grouped ? blocks.findIndex((b) => !blockUnseen(b)) : -1;
  // Work groups by when: deadlines first, then the rest by their newest message.
  const weekStart = startOfWeek(new Date(), 0);
  const lastWeekStart = startOfWeek(new Date(), 1);
  const when = (t: ThreadListItem) => {
    if (t.deadlineAt) return "deadlines";
    const at = new Date(t.lastMessageAt).getTime();
    return at >= weekStart ? "this week" : at >= lastWeekStart ? "last week" : "older";
  };
  const whenAt = (i: number) => (work && grouped && blocks[i] ? when(blocks[i].threads[0]) : null);

  const row = (t: ThreadListItem, nested = false) => (
    // A hairline under every thread, so each one reads as its own box where it starts and ends.
    <li key={t.id} className="relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
      <ThreadRow
        thread={t}
        accountColors={t.accountIds.map((id) => accountColors[id])}
        accountSlots={accountSlots}
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
    <div ref={glideRef} className="relative">
      <Glider root={glideRef} selector={sel.focusedId ? `[data-thread-id="${sel.focusedId}"]` : null} memory={`list:${sel.view}`} watch={ids} className="bg-accent" />
      <ul ref={listRef} aria-label="threads" className="@container flex flex-col py-1">
      {blocks.map((b, i) => {
        const labels = (
          <>
            {i === firstUnseen && unseen > 0 ? <GroupLabel>{unseen} unseen</GroupLabel> : null}
            {i === firstSeen && unseen > 0 ? <GroupLabel>seen</GroupLabel> : null}
            {whenAt(i) && whenAt(i) !== whenAt(i - 1) ? <GroupLabel>{whenAt(i)}</GroupLabel> : null}
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
              accountSlots={accountSlots}
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
    </div>
  );
}

/**
 * A group of machine mail from one source. Collapsed it is one row standing for all of them, the
 * keyboard's stop, in the same columns as a thread row; expanded it is a slim header over its threads.
 */
function ClusterRow({
  label,
  threads,
  collapsed,
  accountColors,
  accountSlots,
  focused,
  open,
  onToggle,
}: {
  label: string;
  threads: ThreadListItem[];
  collapsed: boolean;
  accountColors: (string | undefined)[];
  accountSlots: number;
  focused: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const head = threads[0];
  const fresh = threads.filter((t) => t.unseen).length;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  if (!collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="flex h-row min-w-0 items-center gap-2 border-l-2 border-transparent pr-3 pl-6 text-left text-11 text-text-muted transition-colors duration-80 ease-snap hover:bg-surface-raised/50 hover:text-text focus-visible:border-accent focus-visible:bg-surface-raised"
      >
        <Chevron aria-hidden className="-ml-4 size-3 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{threads.length}</span>
      </button>
    );
  }

  return (
    <div data-group-ids={threads.map((t) => t.id).join(" ")} className="relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-current={open ? "page" : undefined}
        data-thread-id={head.id}
        title={head.subject}
        className={cn(
          "relative z-10 flex h-touch w-full min-w-0 items-center gap-2 border-l-2 pr-3 pl-6 text-left leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised md:h-row",
          focused ? "border-transparent bg-surface-raised" : "border-transparent hover:bg-surface-raised/50",
        )}
      >
        <span className="sr-only">group of {threads.length} threads, {fresh} unseen, newest {head.subject}; </span>
        <Chevron aria-hidden className="absolute left-2 size-3 text-text-muted" strokeWidth={1.5} />
        <AccountSlot colors={accountColors} slots={accountSlots} />
        <span className={cn("w-sender shrink-0 truncate @min-[560px]:w-judged", fresh ? "font-medium text-text" : "text-text-muted")}>
          {label} <span className="font-normal text-text-dim tabular-nums">{threads.length}</span>
        </span>
        <span aria-hidden className={cn("hidden min-w-0 flex-1 truncate @min-[320px]:block", fresh ? "text-text" : "text-text-muted")}>{head.subject}</span>
        <span className="flex-1 @min-[320px]:hidden" />
        <Time iso={head.lastMessageAt} className="min-w-time shrink-0 text-right text-11 tabular-nums text-text-muted" />
      </button>
    </div>
  );
}

/**
 * The account column: one square per account the conversation reached, in a slot sized for every
 * account the user has, so the sender column starts at the same place on every row.
 */
function AccountSlot({ colors, slots }: { colors: (string | undefined)[]; slots: number }) {
  if (slots < 2) return null;
  return (
    <span aria-hidden className="flex shrink-0 gap-0.5" style={{ width: `calc(var(--spacing) * ${slots * 2.5 - 0.5})` }}>
      {colors.map((c, i) => (
        <AccountSquare key={i} color={c} />
      ))}
    </span>
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

/** Monday 00:00 local time, `weeksBack` weeks before the week holding `d`. */
function startOfWeek(d: Date, weeksBack: number): number {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksBack);
  return monday.getTime();
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-11 text-text-dim">{children}</div>;
}

function ThreadRow({
  thread: t,
  accountColors,
  accountSlots,
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
  /** One per account the conversation reached: twins show a square for each. */
  accountColors: (string | undefined)[];
  accountSlots: number;
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
  /** Rows set by who wrote: a person's sender stays lit, whose turn it is on the sender. */
  byKind: boolean;
  /** Inside an open group: indented past the group's guide line. */
  nested?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const overdue = !!t.deadlineAt && new Date(t.deadlineAt).getTime() < now;
  const status = [t.resurfaced && "back", t.needsReply && "needs reply", overdue && "overdue", work && t.deadlineAt && !overdue && `due ${fullTime(t.deadlineAt)}`].filter(Boolean);
  const person = byKind && t.kind === "person";
  // The user wrote last: the next move is theirs, so the row steps back.
  const theirTurn = person && t.lastFromMe && !t.unseen;
  const others = theirTurn ? t.sender.split(", ").filter((n) => n !== "me").join(", ") : t.sender;
  const today = new Date(t.lastMessageAt).toDateString() === new Date(now).toDateString();
  const lit = t.unseen || (person && !theirTurn);
  const time = showSnooze && t.snoozedUntil ? t.snoozedUntil : t.lastMessageAt;
  const preview = (t.summary || t.snippet)?.trim();

  const label = (
    <span className="sr-only">
      {selected ? "selected; " : ""}
      {byKind ? `${t.kind === "machine" ? "automated" : "person"}; ` : ""}
      {theirTurn ? "you wrote last; " : ""}
      {accountNames.join(", ")}; {t.unseen ? "unseen" : "seen"}
      {status.length ? `; ${status.join(", ")}` : ""};{" "}
    </span>
  );

  return (
    <Link
      href={href}
      scroll={false}
      aria-current={open ? "page" : undefined}
      data-selected={selected || undefined}
      data-thread-id={t.id}
      onClick={onSelect}
      title={preview || t.subject}
      className={cn(
        nested ? "pl-8" : "pl-6",
        "flex h-touch min-w-0 items-center gap-2 border-l-2 pr-3 leading-list transition-colors duration-80 ease-snap focus-visible:border-accent focus-visible:bg-surface-raised md:h-row",
        focused
          ? "border-transparent bg-surface-raised"
          : selected
            ? "border-transparent bg-accent-dim/40"
            : "border-transparent hover:bg-surface-raised/50",
      )}
    >
      {label}
      <AccountSlot colors={accountColors} slots={accountSlots} />
      <span className={cn("flex w-sender shrink-0 items-center gap-1 @min-[560px]:w-judged", t.unseen && "font-medium", lit ? "text-text" : "text-text-muted")}>
        {work && t.unseen ? <UnreadDot /> : null}
        <span className="min-w-0 truncate">
          {theirTurn ? <span className="font-normal text-text-dim">{others ? "you, " : "you"}</span> : null}
          {others}
        </span>
        {t.messageCount > 1 ? <span className="shrink-0 font-normal text-text-dim tabular-nums">{t.messageCount}</span> : null}
      </span>
      {t.resurfaced ? <span aria-hidden><Badge>back</Badge></span> : null}
      <span className="hidden min-w-0 flex-1 truncate @min-[320px]:block">
        <span className={t.unseen ? "font-medium text-text" : "text-text-muted"}>{t.subject}</span>
        {preview ? <span className="text-text-dim"> · {preview}</span> : null}
      </span>
      <span className="flex-1 @min-[320px]:hidden" />
      <span className="flex shrink-0 items-center gap-1" aria-hidden>
        {t.needsReply ? <Badge className="bg-signal/15 text-signal">reply</Badge> : null}
        {overdue ? <Badge className="text-warning">overdue</Badge> : work && t.deadlineAt ? <Badge>due <Time iso={t.deadlineAt} /></Badge> : null}
      </span>
      <Time iso={time} className={cn("min-w-time shrink-0 text-right text-11 tabular-nums", person && lit && today ? "text-text" : "text-text-muted")} />
    </Link>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-sm bg-surface-raised px-1 text-11 whitespace-nowrap text-text-muted", className)}>{children}</span>
  );
}
