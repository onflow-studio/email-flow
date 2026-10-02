"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";

import { refreshSync } from "@/app/(mail)/actions";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import { needsReconnect, reconnectHref } from "@/lib/gmail/status";
import { expiryText } from "@/lib/sync/expiry";

import { COMMANDS, effectiveKeys, type CommandId } from "./keys/commands";
import { useOverrides, usePendingKeys, shortcutOf } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { AccountSquare } from "./account-square";
import { Time } from "./time";

type SyncAccount = {
  id: string;
  email: string;
  label: string;
  color: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  // Gmail access about to lapse, or lapsed, by the refresh token's age (lib/sync/expiry.ts).
  accessExpiry: { state: "expiring" | "expired"; expiresAt: string } | null;
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

  // Only a new Google consent fixes these: Google refused the token, or its lifetime ran out.
  const reconnect = accounts.filter((a) => needsReconnect(a.lastSyncError) || a.accessExpiry?.state === "expired");
  const retry = accounts.filter((a) => a.lastSyncError && !reconnect.includes(a));
  const expiring = accounts.filter((a) => a.accessExpiry?.state === "expiring" && !reconnect.includes(a));
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
  else if (reconnect.length || retry.length || expiring.length) {
    const notes: React.ReactNode[] = [
      ...reconnect.map((a) => (
        <span key={a.id}>
          {a.label}: gmail access expired, <ReconnectLink email={a.email} />
        </span>
      )),
      ...(retry.length ? [<span key="retry">sync failed for {retry.map((a) => a.label).join(", ")}, retry</span>] : []),
      ...expiring.map((a) => (
        <span key={a.id} suppressHydrationWarning>
          {a.label}: {expiryText(a.accessExpiry!)}, <ReconnectLink email={a.email} />
        </span>
      )),
    ];
    state = <span className="text-warning">{notes.flatMap((n, i) => (i ? ["; ", n] : [n]))}</span>;
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

/** Straight into Google consent for this address, the same flow settings uses. */
function ReconnectLink({ email }: { email: string }) {
  // OAuth start is a route handler redirecting to Google, not a page, so a plain link.
  return (
    <a href={reconnectHref(email)} className="underline decoration-warning underline-offset-2 hover:text-text">
      reconnect
    </a>
  );
}
