"use client";

import { useSearchParams } from "next/navigation";

/** The OAuth callback lands here with `connected` or `error`; otherwise the account count. */
export function SettingsStatus({ accountCount }: { accountCount: number }) {
  const params = useSearchParams();
  const error = params.get("error");
  const connected = params.get("connected");
  if (error) return <span className="truncate text-danger">{error}</span>;
  if (connected) return <span className="truncate">connected {connected}</span>;
  return <span>{accountCount} of 3 accounts</span>;
}
