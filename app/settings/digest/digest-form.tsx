"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { StaleSettings } from "@/lib/db/settings";

import { saveDigest } from "../actions";

const fields = [
  { key: "workDays", label: "work" },
  { key: "replyDays", label: "reply" },
  { key: "triageDays", label: "triage" },
] as const;

export function DigestForm({ initial }: { initial: StaleSettings }) {
  const [state, action, pending] = useActionState(saveDigest, null);
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
              className="h-row w-field rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none focus:border-accent"
            />
            <span className="text-11 text-text-dim">days</span>
          </label>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "saving" : "save"}</Button>
          {state ? <span role="status" className={`text-11 ${state.ok ? "text-text-muted" : "text-danger"}`}>{state.message}</span> : null}
        </div>
      </form>
    </section>
  );
}
