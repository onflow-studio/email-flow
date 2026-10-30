"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { setWorkOn, type WorkState } from "./work-actions";

/** The Work list switch, under the projects that can take its place. */
export function WorkSection({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<WorkState, FormData>(setWorkOn, null);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-15 font-medium">work list</h2>
      <p className="text-text-muted">
        {on
          ? "a list of threads you are working on, key w. turn it off when projects hold your work: its threads go back to inbox"
          : "off. projects hold your work; w and the work list are hidden"}
      </p>
      <form action={action} className="flex items-center gap-3">
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <Button size="sm" type="submit" disabled={pending}>
          {on ? "turn off" : "turn on"}
        </Button>
        {state ? (
          <span role="status" className={state.ok ? "text-11 text-text-muted" : "text-11 text-warning"}>
            {state.message}
          </span>
        ) : null}
      </form>
    </section>
  );
}
