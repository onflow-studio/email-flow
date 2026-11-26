"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import type { ViewCounts } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { useKeys } from "./keys/keymap";
import { RailCount, useRailGroups, type RailItem } from "./rail";
import { mailHref, type ViewSlug } from "./views";

/**
 * Phone: the open view's name; tapping it lists every view, grouped as the rail groups them.
 * `inline` sits in the list heading; otherwise it is a bar of its own.
 */
export function ViewPicker({ view, counts, inline = false }: { view: ViewSlug; counts: ViewCounts; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const { act, own, later, bottom } = useRailGroups(counts);
  const currentHref = mailHref(view);
  const current = [...act, ...own, ...later, ...bottom].find((it) => it.href === currentHref);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const swipe = useRef<number | null>(null);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useKeys(open ? [{ keys: "escape", run: close }] : [], { exclusive: open });

  const row = (it: RailItem) => {
    const Icon = it.icon;
    const active = it.href === currentHref;
    return (
      <li key={it.key}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={cn(
            "flex h-touch items-center gap-3 border-l-2 pr-4 pl-3.5",
            active ? "rail-active font-medium text-text" : "border-transparent text-text",
          )}
        >
          <Icon aria-hidden className={cn("size-4.5 shrink-0", active ? "text-accent" : "text-text-muted")} strokeWidth={1.5} />
          <span className={cn("min-w-0 flex-1 truncate", it.fresh && "font-medium")}>{it.label}</span>
          <RailCount item={it} active={active} />
        </Link>
      </li>
    );
  };
  const group = (items: RailItem[], label?: string) =>
    items.length ? (
      <ul aria-label={label} className="flex flex-col border-t border-border py-1 first:border-t-0">
        {items.map(row)}
      </ul>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-touch min-w-0 items-center gap-2 text-left md:hidden",
          inline ? "-ml-3 pl-3 pr-2" : "shrink-0 border-b border-border px-3",
        )}
      >
        <span className={cn("min-w-0 truncate font-medium", !inline && "flex-1")}>{current?.label ?? view}</span>
        {current && !inline ? <RailCount item={current} active /> : null}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-bg/60 md:hidden" onClick={close}>
          <div
            role="dialog"
            aria-label="views"
            className="fixed inset-x-0 bottom-0 box-content flex max-h-compose-h flex-col border-t border-border bg-surface-top pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex h-touch shrink-0 items-center justify-between pl-4 text-11 text-text-muted"
              onTouchStart={(e) => (swipe.current = e.touches[0].clientY)}
              onTouchEnd={(e) => {
                // A swipe down on the header puts the sheet away.
                if (swipe.current !== null && e.changedTouches[0].clientY - swipe.current > 40) close();
                swipe.current = null;
              }}
            >
              <span>views</span>
              <button type="button" aria-label="close" onClick={close} className="flex size-touch items-center justify-center text-text-muted">
                <X aria-hidden className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <nav aria-label="views" className="min-h-0 overflow-y-auto">
              {group(act)}
              {group(own, "projects")}
              {group(later)}
              {group(bottom)}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
