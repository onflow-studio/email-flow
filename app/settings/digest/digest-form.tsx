"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { DigestSettings, StaleSettings } from "@/lib/db/settings";

import { saveDigest } from "../actions";

const fields = [
  { key: "workDays", label: "work" },
  { key: "replyDays", label: "reply" },
  { key: "triageDays", label: "triage" },
] as const;

const input = "h-row w-field rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none focus:border-accent";

// The schedule is null until one is saved; the zone then starts as the browser's own.
export function DigestForm({
  initial,
  schedule,
  defaults,
  zones,
}: {
  initial: StaleSettings;
  schedule: DigestSettings | null;
  defaults: DigestSettings;
  zones: string[];
}) {
  const [state, action, pending] = useActionState(saveDigest, null);
  const zone = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!schedule && zone.current) zone.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [schedule]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-15 font-medium">digest</h1>
      <p className="text-13 text-text-muted">show threads after this many days</p>
      <form action={action} className="flex flex-col gap-4">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3">
            <span className="w-label text-13 text-text-muted">{label}</span>
            <input
              type="number"
              name={key}
              defaultValue={initial[key]}
              min={1}
              max={90}
              step={1}
              required
              className={input}
            />
            <span className="text-11 text-text-dim">days</span>
          </label>
        ))}
        <p className="text-13 text-text-muted">make the daily digest at this hour</p>
        <label className="flex items-center gap-3">
          <span className="w-label text-13 text-text-muted">hour</span>
          <input
            type="number"
            name="hour"
            defaultValue={(schedule ?? defaults).hour}
            min={0}
            max={23}
            step={1}
            required
            className={input}
          />
          <span className="text-11 text-text-dim">0 to 23</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-label text-13 text-text-muted">zone</span>
          <input
            ref={zone}
            name="timeZone"
            defaultValue={(schedule ?? defaults).timeZone}
            list="digest-zones"
            autoComplete="off"
            spellCheck={false}
            required
            className={input}
          />
          <datalist id="digest-zones">
            {zones.map((z) => <option key={z} value={z} />)}
          </datalist>
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "saving" : "save"}</Button>
          {state ? <span role="status" className={`text-11 ${state.ok ? "text-text-muted" : "text-danger"}`}>{state.message}</span> : null}
        </div>
      </form>
    </section>
  );
}
