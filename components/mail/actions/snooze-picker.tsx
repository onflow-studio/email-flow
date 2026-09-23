"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd, KeyHints } from "@/components/ui/kbd";
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

/** `snoozedUntil` is set when the thread is already snoozed: the picker says so and offers unsnooze. */
export function SnoozePicker({
  snoozedUntil = null,
  onPick,
  onUnsnooze,
  onClose,
}: {
  snoozedUntil?: string | null;
  onPick: (snooze: Snooze) => void;
  onUnsnooze: () => void;
  onClose: () => void;
}) {
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
      ...(snoozedUntil ? [{ keys: "u", run: onUnsnooze }] : []),
      { keys: "escape", allowInInput: true, run: onClose },
    ],
    { exclusive: true },
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-4 pt-palette-top" onClick={onClose}>
      <div
        role="dialog"
        aria-label="snooze"
        className="flex w-full max-w-palette flex-col gap-3 rounded-md border border-border bg-surface-top p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between text-11 text-text-muted">
          {snoozedUntil ? (
            <span>
              snoozed until{" "}
              <span className="text-text" suppressHydrationWarning>
                {fullTime(snoozedUntil)}
              </span>
            </span>
          ) : (
            <span>snooze</span>
          )}
          <KeyHints hints={[["escape", "close"]]} />
        </div>

        {snoozedUntil ? (
          <button
            type="button"
            onClick={onUnsnooze}
            className="flex h-touch w-full items-center justify-between gap-4 rounded-sm px-2 transition-colors duration-80 ease-snap hover:bg-surface-raised md:h-row"
          >
            <span>unsnooze</span>
            <Kbd keys="u" />
          </button>
        ) : null}

        <ul className={cn("flex flex-col", snoozedUntil && "border-t border-border pt-3")}>
          {presets.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => pick(p.until)}
                className="flex h-touch w-full items-center justify-between gap-4 rounded-sm px-2 transition-colors duration-80 ease-snap hover:bg-surface-raised md:h-row"
              >
                <span>{p.label}</span>
                <span className="flex items-center gap-4 text-11 text-text-muted">
                  <span suppressHydrationWarning>{fullTime(p.until.toISOString())}</span>
                  <Kbd keys={p.key} />
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
          <label htmlFor="snooze-custom" className="w-label shrink-0 text-text-muted">
            until
          </label>
          <input
            id="snooze-custom"
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-touch min-w-0 flex-1 rounded-sm md:h-row border border-border bg-surface px-2 outline-none focus:border-accent"
          />
          <Button type="submit" shortcut="enter">
            snooze
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-4 border-t border-border px-2 pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={needsReply}
            onClick={() => setNeedsReply((v) => !v)}
            className="group flex h-touch items-center gap-2 outline-none md:h-row"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 items-center justify-center rounded-sm border transition-colors duration-80 ease-snap group-focus-visible:border-accent",
                needsReply ? "border-accent bg-accent text-bg" : "border-text-muted bg-bg group-hover:border-text",
              )}
            >
              {needsReply ? <Check className="size-3" strokeWidth={2.5} /> : null}
            </span>
            <span className={needsReply ? "text-text" : "text-text-muted"}>needs reply</span>
            <Kbd keys="r" />
          </button>
          <label className="flex items-center gap-2 text-text-muted">
            deadline
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-touch rounded-sm border border-border bg-surface px-2 text-text md:h-row outline-none focus:border-accent"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
