"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MovableBucket, ThreadAction } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { useThreadActions } from "./actions/actions";
import { ComposeButton } from "./compose/compose-keys";
import type { CommandId } from "./keys/commands";
import { useKeys, useOverrides, shortcutOf } from "./keys/keymap";
import { useProjects } from "./projects-context";
import { useMailSelection } from "./selection";
import { useWorkOn } from "./work-context";

type Item = { id: CommandId; label: string; run: () => void };

/** The ordinary list heading becomes a toolbar while its rows are picked. */
export function SelectionBar({ label, count, picker }: { label: string; count: string; picker?: React.ReactNode }) {
  const sel = useMailSelection();
  const actions = useThreadActions();
  const overrides = useOverrides();
  const projects = useProjects();
  const workOn = useWorkOn();
  const [menu, setMenu] = useState<"more" | "move" | null>(null);
  const [visible, setVisible] = useState(0);
  const header = useRef<HTMLElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const escRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const picked = sel.selectedIds;
  // A menu belongs to the picks: with none left it is closed, so it cannot hold the keys or reopen on the next pick.
  if (!picked.length && menu) setMenu(null);
  const open = picked.length ? menu : null;
  const run = (action: ThreadAction) => void actions.run(action, picked);
  const move = (bucket: MovableBucket) => run({ type: "move", bucket });
  const items: Item[] = [
    sel.view === "archived"
      ? { id: "archive", label: "unarchive", run: () => run({ type: "unarchive" }) }
      : { id: "archive", label: "archive", run: () => run({ type: "archive" }) },
    { id: "move", label: "move to", run: () => setMenu("move") },
    { id: "snooze", label: "snooze", run: () => actions.openSnooze(picked) },
    { id: "delete", label: "delete", run: () => run({ type: "trash" }) },
    { id: "star", label: "star", run: () => void actions.toggleStar(picked) },
    { id: "read", label: "mark read", run: () => run({ type: "read" }) },
    { id: "unread", label: "mark unread", run: () => run({ type: "unread" }) },
    { id: "spam", label: "spam", run: () => run({ type: "spam" }) },
  ];
  const destinations: { label: string; run: () => void }[] = [
    { label: "inbox", run: () => move("inbox") },
    ...(workOn ? [{ label: "work", run: () => run({ type: "work" }) }] : []),
    ...projects.map((p) => ({ label: p.name, run: () => run({ type: "project", projectId: p.id }) })),
    { label: "news", run: () => move("news") },
    { label: "paper trail", run: () => move("paper_trail") },
    { label: "receipts", run: () => move("receipts") },
  ];

  useLayoutEffect(() => {
    const root = header.current;
    if (!root) return;
    const fit = () => {
      const widths = [...(measure.current?.children ?? [])].map((el) => (el as HTMLElement).offsetWidth);
      const style = getComputedStyle(root);
      const gap = parseFloat(style.columnGap) || 0;
      const itemGap = parseFloat(getComputedStyle(measure.current!).columnGap) || 0;
      const available = root.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
        - (countRef.current?.offsetWidth ?? 0) - (escRef.current?.offsetWidth ?? 0) - (moreRef.current?.offsetWidth ?? 0) - 3 * gap;
      let used = 0;
      let n = 0;
      for (const width of widths) {
        if (used + (n ? itemGap : 0) + width > available) break;
        used += (n ? itemGap : 0) + width;
        n++;
      }
      setVisible(n);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    fit();
    return () => observer.disconnect();
  }, [picked.length, overrides]);

  useKeys(open ? [{ keys: "escape", run: () => setMenu(null) }] : [], { exclusive: !!open });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    // A click inside the email lands in its iframe and never reaches this document; the window blurs instead.
    const onBlur = () => setMenu(null);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  if (!picked.length) {
    return (
      <header className="flex h-touch shrink-0 items-center justify-between border-b border-border px-3 md:h-row">
        {picker}
        <h1 className={cn("font-medium", picker && "hidden md:block")}>{label}</h1>
        <span className="flex items-center gap-2"><span className="text-11 text-text-muted">{count}</span><ComposeButton /></span>
      </header>
    );
  }

  const button = (item: Item) => <Button key={item.id} size="sm" variant={item.id === "delete" ? "delete" : "secondary"} shortcut={shortcutOf(item.id, overrides)} onClick={item.run}>{item.label}</Button>;
  return (
    <header ref={header} role="toolbar" aria-label="selection actions" className="relative flex h-touch shrink-0 items-center gap-1 border-b border-border px-2 md:h-row">
      <span ref={countRef} className="shrink-0 text-12 text-text tabular-nums">{picked.length} selected</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">{items.slice(0, visible).map(button)}</div>
      <div ref={menuRef} className="relative shrink-0">
        <Button ref={moreRef} size="sm" variant="ghost" className={visible === items.length ? "invisible" : undefined} aria-haspopup="menu" aria-expanded={menu !== null} onClick={() => setMenu(menu === "more" ? null : "more")}>more</Button>
        {menu ? (
          <div role="menu" aria-label={menu === "move" ? "move to" : "more actions"} className="absolute right-0 top-full z-30 flex max-h-compose-h min-w-field flex-col overflow-y-auto rounded-md border border-border bg-surface-top py-1">
            {menu === "more" ? items.slice(visible).map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={() => { setMenu(null); item.run(); }} className="flex h-touch items-center justify-between gap-3 px-2 text-left text-12 text-text-muted hover:bg-surface-raised hover:text-text md:h-row">{item.label}{shortcutOf(item.id, overrides) ? <Kbd keys={shortcutOf(item.id, overrides)!} /> : null}</button>
            )) : destinations.map((dest) => (
              <button key={dest.label} type="button" role="menuitem" onClick={() => { setMenu(null); dest.run(); }} className="h-touch px-2 text-left text-12 text-text-muted hover:bg-surface-raised hover:text-text md:h-row">{dest.label}</button>
            ))}
          </div>
        ) : null}
      </div>
      <Button ref={escRef} size="sm" variant="ghost" onClick={sel.clearSelected}>esc</Button>
      <div ref={measure} aria-hidden className="pointer-events-none absolute invisible flex gap-1 whitespace-nowrap">{items.map(button)}</div>
    </header>
  );
}
