"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { useKeys } from "../keys/keymap";
import { fullTime } from "../time";

type Snooze = { until: string; needsReply: boolean; deadline: string | null };

function at(base: Date, days: number, hour: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Presets in the viewer's local time. */
export function snoozePresets(now = new Date()) {
  const later = new Date(now);
  later.setHours(later.getHours() + 3, 0, 0, 0);
  const toSaturday = ((6 - now.getDay() + 7) % 7) || 7;
  const toMonday = ((1 - now.getDay() + 7) % 7) || 7;
  return [
    { key: "1", label: "later today", until: later },
    { key: "2", label: "tomorrow", until: at(now, 1, 8) },
    { key: "3", label: "this weekend", until: at(now, toSaturday, 9) },
    { key: "4", label: "next week", until: at(now, toMonday, 8) },
  ].filter((p) => p.label !== "later today" || p.until.getDate() === now.getDate());
}

// datetime-local and date inputs speak local time without a zone.
const pad = (n: number) => n.toString().padStart(2, "0");
const localInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function SnoozePicker({ onPick, onClose }: { onPick: (snooze: Snooze) => void; onClose: () => void }) {
  const [presets] = useState(() => snoozePresets());
  const [needsReply, setNeedsReply] = useState(false);
  const [custom, setCustom] = useState(() => localInput(at(new Date(), 1, 8)));
  const [deadline, setDeadline] = useState("");

  const pick = (until: Date) => {
    if (Number.isNaN(until.getTime()) || until <= new Date()) return;
    const due = deadline ? new Date(`${deadline}T18:00`) : null;
    onPick({ until: until.toISOString(), needsReply, deadline: due ? due.toISOString() : null });
  };

  useKeys(
    [
      ...presets.map((p) => ({ keys: p.key, run: () => pick(p.until) })),
      { keys: "r", run: () => setNeedsReply((v) => !v) },
      { keys: "escape", allowInInput: true, run: onClose },
    ],
    { exclusive: true },
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-4 pt-[15vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="snooze"
        className="flex w-full max-w-palette flex-col gap-3 rounded-md border border-border bg-surface-top p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between text-11 text-text-muted">
          <span>snooze</span>
          <span>esc close</span>
        </div>

        <ul className="flex flex-col">
          {presets.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => pick(p.until)}
                className="flex h-row w-full items-center justify-between gap-4 rounded-sm px-2 transition-colors duration-80 ease-snap hover:bg-surface-raised"
              >
                <span>{p.label}</span>
                <span className="flex items-center gap-4 text-11 text-text-muted">
                  <span suppressHydrationWarning>{fullTime(p.until.toISOString())}</span>
                  <kbd className="opacity-60">{p.key}</kbd>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <form
          className="flex items-center gap-2 px-2"
          onSubmit={(e) => {
            e.preventDefault();
            pick(new Date(custom));
          }}
        >
          <label htmlFor="snooze-custom" className="w-20 shrink-0 text-text-muted">
            until
          </label>
          <input
            id="snooze-custom"
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-row min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="h-row shrink-0 rounded-sm border border-border px-3 transition-colors duration-80 ease-snap hover:bg-surface-raised"
          >
            snooze <kbd className="text-11 opacity-60">enter</kbd>
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-4 border-t border-border px-2 pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={needsReply}
            onClick={() => setNeedsReply((v) => !v)}
            className="flex h-row items-center gap-2"
          >
            <span
              aria-hidden
              className={cn("size-3 rounded-sm border", needsReply ? "border-accent bg-accent" : "border-border")}
            />
            <span className={needsReply ? "text-text" : "text-text-muted"}>needs reply</span>
            <kbd className="text-11 text-text-muted opacity-60">r</kbd>
          </button>
          <label className="flex items-center gap-2 text-text-muted">
            deadline
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-row rounded-sm border border-border bg-surface px-2 text-text outline-none focus:border-accent"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
