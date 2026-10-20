"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

import { useThreadActions } from "./actions";

/** DESIGN.md star: filled `--warning` when starred, an outline in `--text-dim` when not. */
export function StarGlyph({ on, className }: { on: boolean; className?: string }) {
  return <Star aria-hidden className={cn("size-3", className)} fill={on ? "currentColor" : "none"} strokeWidth={1.5} />;
}

/** Stars or unstars one thread at once, with undo. */
export function StarToggle({ id, starred, label, className }: { id: string; starred: boolean; label: string; className?: string }) {
  const { run } = useThreadActions();
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={`${starred ? "unstar" : "star"} ${label}`}
      title={starred ? "unstar" : "star"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void run({ type: starred ? "unstar" : "star" }, [id]);
      }}
      className={cn(
        "flex items-center justify-center outline-none transition-colors duration-80 ease-snap focus-visible:text-accent",
        starred ? "text-warning" : "text-text-dim hover:text-text",
        className,
      )}
    >
      <StarGlyph on={starred} />
    </button>
  );
}
