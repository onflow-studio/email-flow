"use client";

import { useActionState, useRef, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { RuleStructure } from "@/lib/ai/rules";
import { cn } from "@/lib/utils";

import { addRule, deleteRule, reparseRule, setRuleEnabled } from "./rule-actions";

export type RuleRow = { id: string; text: string; enabled: boolean; structured: RuleStructure | null };

const input =
  "rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none transition-colors duration-80 ease-snap placeholder:text-text-dim focus:border-accent";

export function RulesSection({ rules, parserConfigured }: { rules: RuleRow[]; parserConfigured: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, adding] = useActionState(async (prev: Awaited<ReturnType<typeof addRule>>, data: FormData) => {
    const result = await addRule(prev, data);
    if (result?.ok) form.current?.reset();
    return result;
  }, null);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-15 font-medium">rules</h2>
      <p className="text-text-muted">plain language, read by the classifier on every new thread</p>
      {!parserConfigured ? (
        <p className="text-warning">anthropic key not set, rules are saved as plain text. set ANTHROPIC_API_KEY in .env</p>
      ) : null}

      <form ref={form} action={action} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="text"
          required
          minLength={3}
          maxLength={500}
          autoComplete="off"
          placeholder="vercel failed payments go to inbox"
          aria-label="new rule"
          className={cn(input, "h-row min-w-0 flex-1")}
        />
        <Button type="submit" disabled={adding}>
          {adding ? "parsing" : "add rule"}
        </Button>
      </form>
      {state ? (
        <p role="status" className={cn("text-11", state.ok ? "text-text-muted" : "text-warning")}>
          {state.message}
        </p>
      ) : null}

      <div className="rounded-sm border border-border bg-surface px-3">
        {rules.length === 0 ? (
          <p className="py-4 text-text-muted">no rules</p>
        ) : (
          rules.map((rule) => <Rule key={rule.id} rule={rule} />)
        )}
      </div>
    </section>
  );
}

function Rule({ rule }: { rule: RuleRow }) {
  const [pending, start] = useTransition();

  return (
    <div className={cn("flex flex-col gap-1 border-b border-border py-3 last:border-b-0", pending && "opacity-60")}>
      <div className="flex items-start gap-3">
        <p className={cn("min-w-0 flex-1 leading-prose", rule.enabled ? "text-text" : "text-text-dim")}>{rule.text}</p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => start(() => setRuleEnabled(rule.id, !rule.enabled))}
          >
            {rule.enabled ? "disable" : "enable"}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => start(() => deleteRule(rule.id))}>
            delete
          </Button>
        </div>
      </div>
      {rule.structured ? (
        <p className="text-11 text-info">{">>"} {rule.structured.summary}</p>
      ) : (
        <p className="flex items-center gap-2 text-11 text-warning">
          <span>not parsed, classify reads the text only</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => reparseRule(rule.id))}
            className="text-text-muted underline decoration-text-dim underline-offset-2 transition-colors duration-80 ease-snap hover:text-text"
          >
            retry parse
          </button>
        </p>
      )}
      {!rule.enabled ? <p className="text-11 text-text-dim">disabled</p> : null}
    </div>
  );
}
