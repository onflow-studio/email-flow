"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { MovableBucket } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

import { useCompose } from "../compose/compose";
import { useKeys, useOverrides, shortcutOf } from "../keys/keymap";
import { useMailSelection } from "../selection";
import type { ViewSlug } from "../views";
import type { CommandId } from "../keys/commands";
import { useThreadActions } from "./actions";

type BarAction = {
  id: string;
  label: string;
  keys?: string;
  run: () => void;
  tone?: "delete";
  /** Senders the action decides on, shown after the label (let in, keep out). */
  who?: Who;
  /** Opens a menu of these instead of running. */
  menu?: BarAction[];
};

type Who = { names: string[]; more: number; title: string };

/** Up to two names, the rest counted. */
function whoOf(judged: ThreadDetail["judged"]): Who | undefined {
  if (!judged.length) return undefined;
  return {
    names: judged.slice(0, 2).map((s) => s.name || s.email),
    more: Math.max(0, judged.length - 2),
    title: judged.map((s) => (s.name ? `${s.name} <${s.email}>` : s.email)).join(", "),
  };
}

/** `let in Nora Quint, Teo Marsh +1`: each name truncates, the count stays. */
function Label({ action }: { action: BarAction }) {
  if (!action.who) return action.label;
  const { names, more } = action.who;
  return (
    <span className="flex min-w-0 max-w-full overflow-hidden whitespace-pre">
      {`${action.label} `}
      {names.map((name, i) => (
        <span key={i} className="flex min-w-0">
          <span className="max-w-judged truncate">{name}</span>
          {i < names.length - 1 ? ", " : null}
        </span>
      ))}
      {more ? ` +${more}` : null}
    </span>
  );
}

type Layout = { large: BarAction[]; small: BarAction[]; more: BarAction[] };

// Keeps the bar clear of the radio in the corner; centered, so both sides give it up.
const RADIO_CLEARANCE = 64;

const MOVES: { bucket: MovableBucket; label: string }[] = [
  { bucket: "inbox", label: "inbox" },
  { bucket: "news", label: "news" },
  { bucket: "paper_trail", label: "paper trail" },
  { bucket: "receipts", label: "receipts" },
];

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );

/** DESIGN.md action bar: the view's actions, large then small then `more`. Conditional ones appear only when they apply. */
function useLayout(thread: ThreadDetail, view: ViewSlug): Layout {
  const { run, runSender, openSnooze, openDeadline, toggleWork, unsubscribe } = useThreadActions();
  const compose = useCompose();
  const overrides = useOverrides();
  const key = (id: CommandId) => shortcutOf(id, overrides);
  const ids = [thread.id];

  const reply: BarAction = { id: "reply", label: "reply", keys: key("reply"), run: () => compose.open("reply", thread.id) };
  const replyAll: BarAction = { id: "reply-all", label: "reply all", keys: key("reply-all"), run: () => compose.open("reply-all", thread.id) };
  const forward: BarAction = { id: "forward", label: "forward", keys: key("forward"), run: () => compose.open("forward", thread.id) };
  const archive: BarAction = { id: "archive", label: "archive", keys: key("archive"), run: () => void run({ type: "archive" }, ids) };
  const snooze: BarAction = { id: "snooze", label: "snooze", keys: key("snooze"), run: openSnooze };
  const unsnooze: BarAction | null = thread.snoozedUntil
    ? { id: "unsnooze", label: "unsnooze", run: () => void run({ type: "unsnooze" }, ids) }
    : null;
  const work: BarAction = {
    id: "work",
    label: view === "work" && thread.work ? "done" : "work",
    keys: key("work"),
    run: () => void (view === "work" && thread.work ? toggleWork(thread.id) : run({ type: "work" }, ids)),
  };
  const needsReply: BarAction = thread.needsReply
    ? { id: "needs-reply", label: "no reply needed", run: () => void run({ type: "flag", needsReply: false }, ids) }
    : { id: "needs-reply", label: "needs reply", run: () => void run({ type: "flag", needsReply: true }, ids) };
  const deadline: BarAction = { id: "deadline", label: "deadline", run: openDeadline };
  const del: BarAction = thread.trashed
    ? { id: "restore", label: "restore", run: () => void run({ type: "restore" }, ids) }
    : { id: "delete", label: "delete", keys: key("delete"), tone: "delete", run: () => void run({ type: "trash" }, ids) };
  const unsub: BarAction | null = thread.canUnsubscribe
    ? { id: "unsubscribe", label: "unsubscribe", keys: key("unsubscribe"), run: () => void unsubscribe(thread.id) }
    : null;
  const unread: BarAction = { id: "unread", label: "mark unread", keys: key("unread"), run: () => void run({ type: "unread" }, ids) };
  const spam: BarAction = { id: "spam", label: "mark spam", keys: key("spam"), run: () => void run({ type: "spam" }, ids) };
  const who = whoOf(thread.judged);
  const letIn: BarAction = { id: "let-in", label: "let in", who, keys: key("let-in"), run: () => void runSender({ type: "letIn" }, thread.id) };
  const keepOut: BarAction = { id: "keep-out", label: "keep out", who, keys: key("keep-out"), run: () => void runSender({ type: "keepOut" }, thread.id) };
  const moveTo: BarAction = {
    id: "move",
    label: "move to",
    run: () => {},
    menu: [
      ...MOVES.filter((m) => m.bucket !== thread.bucket).map((m) => ({
        id: `move-${m.bucket}`,
        label: m.label,
        keys: key(`move.${m.bucket}`),
        run: () => void run({ type: "move", bucket: m.bucket }, ids),
      })),
      ...(!thread.work ? [work] : []),
    ],
  };

  const pick = (large: (BarAction | null)[], small: (BarAction | null)[], more: (BarAction | null)[]): Layout => ({
    large: large.filter((a) => !!a),
    small: small.filter((a) => !!a),
    more: more.filter((a) => !!a),
  });

  switch (view) {
    case "triage":
      return pick([letIn, keepOut], [archive, unsub, del], [snooze, work, reply, replyAll, forward, unread, spam]);
    case "news":
    case "paper-trail":
    case "receipts":
      return pick([archive], [unsub, moveTo, del], [reply, replyAll, forward, snooze, unread, spam]);
    case "snoozed":
      return pick([reply, archive, snooze], [unsnooze, del], [replyAll, forward, work, unsub, unread, spam]);
    case "work":
      return pick([work, reply], [snooze, del], [replyAll, forward, needsReply, deadline, unsnooze, unsub, unread, spam]);
    case "trash":
      return pick([del], [], [work, reply, forward, spam]);
    default:
      return pick([reply, archive, snooze], [work, del], [replyAll, forward, unsub, unread, spam]);
  }
}

/** In a menu, `move to` becomes one row per bucket. */
const flatten = (actions: BarAction[]) =>
  actions.flatMap((a) => (a.menu ? a.menu.map((m) => ({ ...m, label: `${a.label} ${m.label}` })) : [a]));

export function ActionBar({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const wide = useWide();
  const { large, small, more } = useLayout(thread, sel.view);
  const barRef = useRef<HTMLDivElement>(null);

  // Secondary actions that do not fit move into `more`, right to left: small first, then large. The primary stays.
  const demotable = sel.view === "triage" ? [...small].reverse() : [...small].reverse().concat([...large.slice(1)].reverse());
  const [room, setRoom] = useState(Infinity);
  const [demoted, setDemoted] = useState(0);
  const moved = new Set((wide ? demotable.slice(0, demoted) : small).map((a) => a.id));
  const shownLarge = large.filter((a) => !moved.has(a.id));
  const shownSmall = small.filter((a) => !moved.has(a.id));
  // Phone keeps delete in the sticky thread header, so the sheet leaves it out.
  const menu = flatten([...large, ...small].filter((a) => moved.has(a.id) && (wide || (a.id !== "delete" && a.id !== "restore"))).concat(more));

  useEffect(() => {
    const pane = barRef.current?.closest("main");
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      setRoom(pane.clientWidth - 2 * RADIO_CLEARANCE);
      setDemoted(0);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!wide || !barRef.current) return;
    if (barRef.current.offsetWidth > room && demoted < demotable.length) setDemoted(demoted + 1);
  }, [wide, room, demoted, demotable.length]);

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="thread actions"
      className={cn(
        "pointer-events-auto flex items-center gap-1 bg-surface-top",
        "box-border w-full border-t border-border px-3 pb-safe",
        "md:w-auto md:rounded-md md:border md:p-1",
      )}
    >
      {shownLarge.map((a, i) => (
        <BarButton key={a.id} action={a} variant={i === 0 && a === large[0] ? "primary" : "secondary"} />
      ))}
      {shownSmall.length || menu.length ? <span aria-hidden className="mx-1 hidden h-4 w-px bg-border md:block" /> : null}
      {shownSmall.map((a) => (
        <BarButton key={a.id} action={a} small variant={a.tone === "delete" ? "delete-ghost" : "ghost"} />
      ))}
      {menu.length ? (
        <MenuButton label="…" ariaLabel="more actions" items={menu} small sheet={!wide} className="ml-auto md:ml-0" />
      ) : null}
    </div>
  );
}

function BarButton({
  action,
  variant,
  small = false,
}: {
  action: BarAction;
  variant: "primary" | "secondary" | "ghost" | "delete-ghost";
  small?: boolean;
}) {
  if (action.menu) return <MenuButton label={action.label} items={action.menu} small={small} />;
  return (
    <Button
      variant={variant}
      size={small ? "sm" : "default"}
      className={action.who ? "min-w-0 flex-1 md:max-w-judged md:flex-none xl:max-w-[300px]" : undefined}
      shortcut={action.keys}
      title={action.who?.title}
      onClick={action.run}
    >
      <Label action={action} />
    </Button>
  );
}

/**
 * `more` and `move to`: a menu 8px above the bar, right-aligned to its button, styled like the
 * station list. Arrow keys move, enter runs, esc or an outside press closes and returns focus.
 * Phone: a sheet of touch rows from the bottom.
 */
function MenuButton({
  label,
  ariaLabel,
  items,
  small = false,
  sheet = false,
  className,
}: {
  label: string;
  ariaLabel?: string;
  items: BarAction[];
  small?: boolean;
  /** Phone: open as a sheet from the bottom, portaled so it sits above the radio and the bar. */
  sheet?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const focusRow = (dir: 1 | -1) => {
    const i = rowRefs.current.findIndex((el) => el === document.activeElement);
    const next = i === -1 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    rowRefs.current[next]?.focus();
  };

  // While open, keys belong to the menu: no `e` or `j` leaking through to the thread.
  useKeys(
    open
      ? [
          { keys: "arrowdown", run: () => focusRow(1) },
          { keys: "arrowup", run: () => focusRow(-1) },
          { keys: "escape", run: close },
        ]
      : [],
    { exclusive: open },
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // A click inside the email lands in its iframe and never reaches this document; the window blurs instead.
    const onBlur = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel ?? label}
      className={
        sheet
          ? "fixed inset-x-0 bottom-0 z-50 box-content flex flex-col border-t border-border bg-surface-top pb-safe"
          : "absolute right-0 bottom-full mb-3 flex flex-col rounded-md border border-border bg-surface-top py-1"
      }
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close();
            item.run();
          }}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse") e.currentTarget.focus({ preventScroll: true });
          }}
          className={cn(
            "flex h-touch items-center gap-4 border-l-2 border-transparent pr-3 pl-2 text-left whitespace-nowrap text-text-muted outline-none transition-colors duration-80 ease-snap md:h-row",
            "focus:glow-focus focus:border-accent focus:bg-surface-raised focus:text-text",
            item.tone === "delete" && "focus:text-danger",
          )}
        >
          <span className="flex-1" title={item.who?.title}>
            <Label action={item} />
          </span>
          {item.keys ? <Kbd keys={item.keys} /> : null}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {open ? (sheet ? createPortal(menu, document.body) : menu) : null}
      <Button
        ref={buttonRef}
        variant="ghost"
        size={small ? "sm" : "default"}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          // Opened from the keyboard (enter or space): start on the first row.
          if (e.detail === 0) requestAnimationFrame(() => rowRefs.current[0]?.focus());
        }}
      >
        {label}
      </Button>
    </div>
  );
}
