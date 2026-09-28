"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { refreshSync } from "@/app/(mail)/actions";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import { needsReconnect } from "@/lib/gmail/status";

import { COMMANDS, effectiveKeys, type CommandId } from "./keys/commands";
import { useOverrides, usePendingKeys, shortcutOf } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { AccountSquare } from "./account-square";
import { Time } from "./time";

type SyncAccount = {
  id: string;
  label: string;
  color: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  // First sync or a stale-cursor recovery still working through its backlog, a slice per pass.
  catchingUp: boolean;
  /** Toggled on in the header. */
  on: boolean;
};

export function StatusLine({ accounts }: { accounts: SyncAccount[] }) {
  const sel = useMailSelection();
  const pending = usePendingKeys();
  const [syncing, startSync] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    startSync(async () => {
      const result = await refreshSync();
      setError(result.ok ? null : result.error);
    });

  const failed = accounts.filter((a) => a.lastSyncError);
  const catchingUp = accounts.filter((a) => a.catchingUp);
  const lastSync = accounts
    .map((a) => a.lastSyncAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  const on = accounts.filter((a) => a.on);

  let state: React.ReactNode;
  if (sel.selectedIds.length) state = <span className="text-text">{sel.selectedIds.length} selected</span>;
  else if (syncing) state = "syncing";
  else if (error) state = <span className="text-warning">{error}</span>;
  else if (failed.length) {
    const reconnect = failed.filter((a) => needsReconnect(a.lastSyncError));
    const retry = failed.filter((a) => !needsReconnect(a.lastSyncError));
    state = (
      <span className="text-warning">
        {reconnect.length ? (
          <>
            sync failed for {reconnect.map((a) => a.label).join(", ")},{" "}
            <Link href="/settings" className="underline decoration-warning underline-offset-2 hover:text-text">
              reconnect
            </Link>
          </>
        ) : null}
        {reconnect.length && retry.length ? "; " : null}
        {retry.length ? <>sync failed for {retry.map((a) => a.label).join(", ")}, retry</> : null}
      </span>
    );
  }
  else if (catchingUp.length) state = `catching up ${catchingUp.map((a) => a.label).join(", ")}`;
  else if (!accounts.length) state = "no accounts";
  else if (lastSync) state = <>synced <Time iso={lastSync} format="ago" /></>;
  else state = "never synced";

  const overrides = useOverrides();
  const key = (id: CommandId) => shortcutOf(id, overrides);
  // j/k style pairs show as `j/k`; an unbound half drops out.
  const pair = (a: CommandId, b: CommandId) =>
    [key(a), key(b)].filter((k): k is string => !!k);
  const hints = (list: [string | string[] | undefined, string][]) =>
    list.filter((h): h is [string | string[], string] => !!h[0] && [h[0]].flat().length > 0);

  let hint: React.ReactNode;
  if (pending.length) {
    // Mid-sequence: every command the typed keys can still finish, with the key that finishes it.
    const typed = pending.join(" ");
    const next = COMMANDS.flatMap((c) =>
      effectiveKeys(c.id, overrides)
        .filter((k) => k.startsWith(`${typed} `))
        .map((k) => [k.slice(typed.length + 1), c.label.replace(/^go to /, "")] as [string, string]),
    );
    hint = (
      <span className="ml-auto hidden min-w-0 items-center gap-3 md:flex">
        <Kbd keys={typed} />
        <KeyHints hints={next} />
      </span>
    );
  } else
    hint = (
      <KeyHints
        className="ml-auto min-w-0"
        hints={hints(
          sel.selectedIds.length
            ? [[key("archive"), "archive"], [key("snooze"), "snooze"], [key("delete"), "delete"], ["escape", "clear"]]
            : sel.pane === "rail"
            ? [[["arrowup", "arrowdown"], "move"], ["arrowright", "open"], [key("key-map"), "keys"]]
            : sel.pane === "reading"
              ? [[["arrowup", "arrowdown"], "scroll"], ["arrowleft", "list"], [pair("thread.next", "thread.prev"), "next"], ["escape", "back"], [key("key-map"), "keys"]]
              : sel.openId
                ? [[pair("thread.next", "thread.prev"), "next"], ["arrowleft", "rail"], ["arrowright", "read"], ["escape", "back"], [key("key-map"), "keys"]]
                : [[pair("thread.next", "thread.prev"), "move"], ["enter", "open"], ["arrowleft", "rail"], [key("key-map"), "keys"]],
        )}
      />
    );

  return (
    <footer className="status-rule box-content flex h-status shrink-0 items-center gap-4 bg-status px-3 pb-safe text-11 text-text-muted">
      <button
        type="button"
        onClick={refresh}
        disabled={syncing}
        aria-label="refresh"
        title="refresh"
        className="-ml-1 flex size-6 items-center justify-center rounded-sm transition-colors duration-80 ease-snap hover:text-text disabled:text-text-dim"
      >
        <RefreshCw aria-hidden className="size-3" strokeWidth={1.5} />
      </button>
      <span className="truncate">{state}</span>
      <span className="hidden items-center gap-2 sm:flex">
        {on.length < accounts.length
          ? on.map((a) => (
              <span key={a.id} className="flex items-center gap-2">
                <AccountSquare color={a.color} />
                {a.label}
              </span>
            ))
          : "all accounts"}
      </span>
      {hint}
    </footer>
  );
}
