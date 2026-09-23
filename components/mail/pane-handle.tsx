"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { writePane, type Pane } from "./panes";

type Bounds = { now: number; min: number; max: number };

const STEP = 8;
const BIG_STEP = 32;

function cssPx(name: string) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

// The pane's rendered width and how far it may go, leaving the reading pane its minimum.
function measure(handle: HTMLElement | null, pane: Pane): Bounds | null {
  const target = handle?.previousElementSibling;
  const shell = handle?.parentElement;
  if (!target || !shell || !handle.offsetParent) return null;
  const room =
    pane === "rail"
      ? shell.clientWidth - cssPx("--list-min") - cssPx("--reading-min")
      : shell.clientWidth - (shell.firstElementChild?.getBoundingClientRect().width ?? 0) - cssPx("--reading-min");
  const min = cssPx(`--${pane}-min`);
  return {
    now: Math.round(target.getBoundingClientRect().width),
    min,
    max: Math.max(min, Math.min(cssPx(`--${pane}-max`), Math.floor(room))),
  };
}

// Sits right after the pane it resizes, on top of that pane's hairline border.
export function PaneHandle({ pane, label, className }: { pane: Pane; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: Bounds } | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [dragging, setDragging] = useState(false);

  function resize(width: number, within: Bounds, persist: boolean) {
    const next = Math.round(Math.min(within.max, Math.max(within.min, width)));
    document.documentElement.style.setProperty(`--${pane}-w`, `${next}px`);
    setBounds({ ...within, now: next });
    if (persist) writePane(pane, next);
  }

  useEffect(() => {
    const update = () => setBounds(measure(ref.current, pane));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [pane]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const start = measure(ref.current, pane);
    if (!start) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start };
    document.documentElement.dataset.resizing = "";
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d) resize(d.start.now + event.clientX - d.x, d.start, false);
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    delete document.documentElement.dataset.resizing;
    setDragging(false);
    const end = measure(ref.current, pane);
    if (end) writePane(pane, end.now);
  }

  function onDoubleClick() {
    document.documentElement.style.removeProperty(`--${pane}-w`);
    writePane(pane, null);
    setBounds(measure(ref.current, pane));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = measure(ref.current, pane);
    if (!current) return;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const target =
      event.key === "ArrowLeft"
        ? current.now - step
        : event.key === "ArrowRight"
          ? current.now + step
          : event.key === "Home"
            ? current.min
            : event.key === "End"
              ? current.max
              : null;
    if (target === null) return;
    event.preventDefault();
    resize(target, current, true);
  }

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={bounds?.now}
      aria-valuemin={bounds?.min}
      aria-valuemax={bounds?.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn("group relative z-10 w-0 shrink-0 outline-none", className)}
    >
      <span aria-hidden className="absolute inset-y-0 -left-1 w-2 cursor-col-resize" />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 -left-px w-px transition-colors duration-80 ease-snap",
          dragging ? "bg-accent" : "group-hover:bg-accent-dim group-focus-visible:bg-accent-dim",
        )}
      />
    </div>
  );
}
