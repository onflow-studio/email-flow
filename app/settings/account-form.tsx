"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/db/schema";
import { ACCOUNT_COLORS } from "@/lib/gmail/colors";

import { saveAccount } from "./actions";

const input =
  "rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none transition-colors duration-80 ease-snap focus:border-accent";

type Props = Pick<Account, "id" | "email" | "label" | "color" | "signatureHtml" | "lastSyncError">;

export function AccountForm({ account }: { account: Props }) {
  const [state, action, pending] = useActionState(saveAccount, null);

  return (
    <form action={action} className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0">
      <input type="hidden" name="id" value={account.id} />
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: account.color }} />
        <span className="min-w-0 flex-1 truncate font-medium">{account.email}</span>
        {account.lastSyncError ? (
          <span className="text-11 text-warning">{account.lastSyncError}</span>
        ) : null}
        <a
          href={`/api/auth/google/start?hint=${encodeURIComponent(account.email)}`}
          className="text-text-muted transition-colors duration-80 ease-snap hover:text-text"
        >
          reconnect
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-4 pl-4">
        <label className="flex flex-col gap-1">
          <span className="text-11 text-text-muted">label</span>
          <input name="label" defaultValue={account.label} maxLength={32} required className={`${input} h-row w-field`} />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-11 text-text-muted">color</legend>
          <div className="flex h-row items-center gap-2">
            {ACCOUNT_COLORS.map((c) => (
              <label key={c.hex} className="flex cursor-pointer items-center" title={c.name}>
                <input
                  type="radio"
                  name="color"
                  value={c.hex}
                  defaultChecked={account.color.toUpperCase() === c.hex}
                  className="peer sr-only"
                />
                <span
                  className="size-4 rounded-sm border-2 border-transparent peer-checked:border-text peer-focus-visible:border-accent"
                  style={{ backgroundColor: c.hex }}
                />
                <span className="sr-only">{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="flex flex-col gap-1 pl-4">
        <span className="text-11 text-text-muted">signature html</span>
        <textarea
          name="signatureHtml"
          defaultValue={account.signatureHtml ?? ""}
          rows={4}
          spellCheck={false}
          placeholder="<p>-- your name</p>"
          className={`${input} resize-y py-2 leading-prose placeholder:text-text-dim`}
        />
      </label>

      <div className="flex items-center gap-3 pl-4">
        <Button type="submit" disabled={pending}>
          {pending ? "saving" : "save"}
        </Button>
        {state ? (
          <span role="status" className={`text-11 ${state.ok ? "text-text-muted" : "text-danger"}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
