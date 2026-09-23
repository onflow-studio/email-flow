"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import { Kbd } from "@/components/ui/kbd";
import type { MovableBucket } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

import { useKeys } from "../keys/keymap";
import { useMailSelection } from "../selection";
import { useThreadActions } from "./actions";

const NAMES: Record<ThreadDetail["bucket"], string> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper trail",
  triage: "triage",
  out: "out",
};

/** The move targets in rail order, each keyed by its `g` go-to letter. */
const TARGETS: { bucket: MovableBucket; key: string }[] = [
  { bucket: "inbox", key: "i" },
  { bucket: "news", key: "n" },
  { bucket: "paper_trail", key: "p" },
];

/**
 * DESIGN.md bucket badge: the thread's bucket in the reading pane meta line, and the way to change it.
 * A low-confidence AI placement shows its doubt; clicking or `m` opens the bucket menu under it.
 */
export function BucketBadge({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const { run } = useThreadActions();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnTo = useRef<HTMLElement | null>(null);

  const doubt = thread.bucketSuggested && thread.bucketSource === "ai";
  const pct = doubt && thread.bucketConfidence !== null ? `${Math.round(thread.bucketConfidence * 100)}%` : null;
  const current = Math.max(
    TARGETS.findIndex((t) => t.bucket === thread.bucket),
    0,
  );

  const show = (focusRow: boolean) => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
    if (focusRow) requestAnimationFrame(() => rowRefs.current[current]?.focus());
  };
  const close = () => {
    setOpen(false);
    (returnTo.current ?? buttonRef.current)?.focus({ preventScroll: true });
  };
  // Same bucket confirms the placement as the user's own; another moves it. Both undoable.
  const pick = (bucket: MovableBucket) => {
    close();
    void run({ type: "move", bucket }, [thread.id]);
  };
  const focusRow = (dir: 1 | -1) => {
    const n = TARGETS.length;
    const i = rowRefs.current.findIndex((el) => el === document.activeElement);
    const next = i === -1 ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n;
    rowRefs.current[next]?.focus();
  };

  useKeys([{ id: "move", when: () => !open && sel.target === thread.id, run: () => show(true) }]);
  // While open, keys belong to the menu: `i` picks inbox here, not let in.
  useKeys(
    open
      ? [
          { keys: "arrowdown", run: () => focusRow(1) },
          { keys: "arrowup", run: () => focusRow(-1) },
          { keys: "escape", run: close },
          ...TARGETS.map((t) => ({ keys: t.key, run: () => pick(t.bucket) })),
        ]
      : [],
    { exclusive: open },
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={pct ? `${NAMES[thread.bucket]}, AI ${pct} sure, move to` : `${NAMES[thread.bucket]}, move to`}
        onClick={(e) => {
          if (open) close();
          // Opened from the keyboard (enter or space): start on the current bucket.
          else show(e.detail === 0);
        }}
        className={cn(
          "flex items-center gap-1 rounded-sm bg-accent-dim px-1 text-text outline-offset-0 transition-[outline-color] duration-80 ease-snap focus-visible:glow-focus",
          doubt ? "outline-1 outline-info outline-dashed" : "outline-1 outline-transparent hover:outline-accent",
        )}
      >
        {NAMES[thread.bucket]}
        {pct ? <span className="text-info">{pct}</span> : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="move to"
          className="absolute top-full left-0 z-20 mt-2 flex flex-col rounded-md border border-border bg-surface-top py-1 text-13"
        >
          {TARGETS.map((t, i) => {
            const here = t.bucket === thread.bucket;
            return (
              <button
                key={t.bucket}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={here}
                tabIndex={-1}
                onClick={() => pick(t.bucket)}
                onPointerMove={(e) => {
                  if (e.pointerType === "mouse") e.currentTarget.focus({ preventScroll: true });
                }}
                className={cn(
                  "flex h-touch items-center gap-2 border-l-2 border-transparent pr-3 pl-2 text-left whitespace-nowrap text-text-muted outline-none transition-colors duration-80 ease-snap md:h-row",
                  "focus:glow-focus focus:border-accent focus:bg-surface-raised focus:text-text",
                )}
              >
                <span className="flex size-3 items-center justify-center text-accent">
                  {here ? <Check aria-hidden className="size-3" strokeWidth={1.5} /> : null}
                </span>
                <span className="flex-1 pr-2">{NAMES[t.bucket]}</span>
                <Kbd keys={t.key} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
