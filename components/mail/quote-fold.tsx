"use client";

/** The trailing quote of a message, folded into one line under the body. */
export function QuoteFold({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-6 w-full items-center justify-center rounded-sm border border-border text-12 text-text-muted transition-colors duration-80 ease-snap outline-none hover:text-text focus-visible:border-accent"
    >
      <span className="truncate px-2">{open ? "hide quoted text" : label}</span>
    </button>
  );
}
