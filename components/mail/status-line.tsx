"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { refreshSync } from "@/app/(mail)/actions";
import { needsReconnect } from "@/lib/gmail/status";

import { usePendingKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { Time } from "./time";
import { VIEWS } from "./views";

type SyncAccount = { id: string; label: string; color: string; lastSyncAt: string | null; lastSyncError: string | null };

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
  else if (!accounts.length) state = "no accounts";
  else if (lastSync) state = <>synced <Time iso={lastSync} format="ago" /></>;
  else state = "never synced";

  let hint: string;
  if (pending[0] === "g") hint = `g- ${VIEWS.filter((v) => v.goKey).map((v) => `${v.goKey} ${v.label}`).join("  ")}`;
  else if (sel.openId) hint = "j/k next  esc back  ? keys";
  else hint = "j/k move  enter open  ? keys";

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
      <span className="hidden items-center gap-1 sm:flex">
        {active ? (
          <>
            <span aria-hidden className="h-2 w-0.5" style={{ backgroundColor: active.color }} />
            {active.label}
          </>
        ) : (
          "all accounts"
        )}
      </span>
      <span className="ml-auto hidden truncate md:inline">{hint}</span>
    </footer>
  );
}
