"use client";

import { createContext, useContext, useOptimistic, useTransition } from "react";

import { toggleAccount } from "@/app/(mail)/actions";

export type ToggleAccount = { id: string; label: string; email: string; color: string; on: boolean };

type AccountToggles = {
  accounts: ToggleAccount[];
  /** Turns an account on or off; the last account that is on stays on. */
  toggle: (id: string) => void;
  /** Changes once the server has applied a toggle, for results fetched per account set. */
  appliedKey: string;
};

const TogglesContext = createContext<AccountToggles | null>(null);

export function useAccountToggles() {
  const ctx = useContext(TogglesContext);
  if (!ctx) throw new Error("useAccountToggles must be used inside <AccountTogglesProvider>");
  return ctx;
}

/** Shared by the header and the palette so both flip the same state at once. */
export function AccountTogglesProvider({ accounts, children }: { accounts: ToggleAccount[]; children: React.ReactNode }) {
  const [, startTransition] = useTransition();
  const [optimistic, flip] = useOptimistic(accounts, (list, id: string) =>
    list.map((a) => (a.id === id ? { ...a, on: !a.on } : a)),
  );

  const toggle = (id: string) => {
    const account = optimistic.find((a) => a.id === id);
    if (!account || (account.on && optimistic.filter((a) => a.on).length === 1)) return;
    startTransition(async () => {
      flip(id);
      await toggleAccount(id);
    });
  };

  const appliedKey = accounts
    .filter((a) => a.on)
    .map((a) => a.id)
    .join();

  return <TogglesContext.Provider value={{ accounts: optimistic, toggle, appliedKey }}>{children}</TogglesContext.Provider>;
}
