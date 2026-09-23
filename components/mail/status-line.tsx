"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";

import { refreshSync } from "@/app/(mail)/actions";
import { cn } from "@/lib/utils";

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
  else if (failed.length)
    state = <span className="text-warning">sync failed for {failed.map((a) => a.label).join(", ")}, retry</span>;
  else if (!accounts.length) state = "no accounts";
  else if (lastSync) state = <>synced <Time iso={lastSync} format="ago" /></>;
  else state = "never synced";

  let hint: string;
  if (pending[0] === "g") hint = `g- ${VIEWS.filter((v) => v.goKey).map((v) => `${v.goKey} ${v.label}`).join("  ")}`;
  else if (sel.openId) hint = "j/k next  esc back  ? keys";
  else hint = "j/k move  enter open  ? keys";

  return (
    <footer className="status-rule flex h-status shrink-0 items-center gap-4 bg-surface px-3 text-11 text-text-muted">
      <button
        type="button"
        onClick={refresh}
        disabled={syncing}
        aria-label="refresh"
        title="refresh"
        className="-ml-1 flex size-5 items-center justify-center rounded-sm transition-colors duration-80 ease-snap hover:text-text disabled:text-text-dim"
      >
        <RefreshCw aria-hidden className={cn("size-3", syncing && "animate-spin")} strokeWidth={1.5} />
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
