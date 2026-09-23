"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast as sonner, Toaster as SonnerToaster } from "sonner";

export type ToastType = "default" | "success" | "error" | "warning";

// DESIGN.md: stack peek and list gap, and how many toasts show in the deck.
const GAP = 8;
const VISIBLE = 3;

/**
 * DESIGN.md toast stack: bottom-left above the status line, a deck that expands into a list on hover.
 * Position, width and motion live in globals.css; each toast renders its own card.
 */
export function Toaster() {
  return <SonnerToaster theme="dark" position="bottom-left" gap={GAP} visibleToasts={VISIBLE} containerAriaLabel="notifications" />;
}

const ICONS = {
  success: <Check aria-hidden className="size-3 shrink-0 text-success" />,
  error: <X aria-hidden className="size-3 shrink-0 text-danger" />,
  warning: <TriangleAlert aria-hidden className="size-3 shrink-0 text-warning" />,
} as const;

export function ToastCard({
  type = "default",
  message,
  children,
}: {
  type?: ToastType;
  message: string;
  /** Right side: an action button, a countdown. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-top px-3 py-2">
      {type === "default" ? null : ICONS[type]}
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {children}
    </div>
  );
}

/** Seconds left, 11px muted tabular. Holds while the stack is hovered or the tab is hidden, as the toast's own timer does. */
export function Countdown({ ms }: { ms: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const paused = document.hidden || ref.current?.closest("[data-sonner-toast]")?.getAttribute("data-expanded") === "true";
      if (!paused) setLeft((l) => Math.max(0, l - (now - last)));
      last = now;
    }, 250);
    return () => clearInterval(id);
  }, []);
  return (
    <span ref={ref} className="w-6 text-right text-11 text-text-muted">
      {Math.ceil(left / 1000)}s
    </span>
  );
}

export function showToast(render: () => React.ReactElement, opts: { id?: string; duration: number }) {
  return sonner.custom(render, opts);
}

export const dismissToast = (id: string) => sonner.dismiss(id);
