"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { refreshSync } from "@/app/(mail)/actions";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import { needsReconnect } from "@/lib/gmail/status";

import { usePendingKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { Time } from "./time";
import { VIEWS } from "./views";

type SyncAccount = {
  id: string;
  label: string;
  color: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  // First sync or a stale-cursor recovery still working through its backlog, a slice per pass.
  catchingUp: boolean;
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
  const active = accounts.find((a) => a.id === sel.account);

  let state: React.ReactNode;
  if (syncing) state = "syncing";
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

  let hint: React.ReactNode;
  if (pending[0] === "g")
    hint = (
      <span className="ml-auto hidden min-w-0 items-center gap-3 md:flex">
        <Kbd keys="g" />
        <KeyHints hints={VIEWS.flatMap((v) => (v.goKey ? [[v.goKey, v.label] as [string, string]] : []))} />
      </span>
    );
  else
    hint = (
      <KeyHints
        className="ml-auto min-w-0"
        hints={
          sel.pane === "rail"
            ? [[["arrowup", "arrowdown"], "move"], ["arrowright", "open"], ["?", "keys"]]
            : sel.pane === "reading"
              ? [[["arrowup", "arrowdown"], "scroll"], ["arrowleft", "list"], [["j", "k"], "next"], ["escape", "back"], ["?", "keys"]]
              : sel.openId
                ? [[["j", "k"], "next"], ["arrowleft", "rail"], ["arrowright", "read"], ["escape", "back"], ["?", "keys"]]
                : [[["j", "k"], "move"], ["enter", "open"], ["arrowleft", "rail"], ["?", "keys"]]
        }
      />
    );

  return (
    <footer className="status-rule box-content flex h-status shrink-0 items-center gap-4 bg-surface px-3 pb-safe text-11 text-text-muted">
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
        {active ? (
          <>
            <span aria-hidden className="size-2" style={{ backgroundColor: active.color }} />
            {active.label}
          </>
        ) : (
          "all accounts"
        )}
      </span>
      {hint}
    </footer>
  );
}
