"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { mailHref, type ViewSlug } from "./views";

/**
 * Which thread the keyboard is on. Actions read `target` to know what to act
 * on (the open thread, else the focused row) and call `focusNext` after
 * removing it from the list.
 */
export type MailSelection = {
  view: ViewSlug;
  account: string | null;
  threadIds: string[];
  focusedId: string | null;
  openId: string | null;
  target: string | null;
  focus: (id: string) => void;
  focusNext: () => void;
  focusPrev: () => void;
  open: (id?: string | null) => void;
  close: () => void;
  go: (view: ViewSlug) => void;
};

const SelectionContext = createContext<MailSelection | null>(null);

type Picked = { id: string | null; index: number };
type FocusStore = { get: (key: string) => Picked | undefined; set: (key: string, picked: Picked) => void };

const FocusStoreContext = createContext<FocusStore | null>(null);

/**
 * Lives in the mail layout. The page remounts when the thread segment
 * changes, so the focused row is remembered here, per view and account.
 */
export function FocusStoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Record<string, Picked>>({});
  const set = useCallback((key: string, picked: Picked) => setStore((prev) => ({ ...prev, [key]: picked })), []);
  const value = useMemo<FocusStore>(() => ({ get: (key) => store[key], set }), [store, set]);
  return <FocusStoreContext.Provider value={value}>{children}</FocusStoreContext.Provider>;
}

export function useMailSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useMailSelection must be used inside <SelectionProvider>");
  return ctx;
}

export function SelectionProvider({
  view,
  account,
  threadIds,
  openId,
  children,
}: {
  view: ViewSlug;
  account: string | null;
  threadIds: string[];
  openId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const store = useContext(FocusStoreContext);
  if (!store) throw new Error("SelectionProvider must be used inside <FocusStoreProvider>");
  const key = `${view}:${account ?? "all"}`;
  const openIndex = openId ? threadIds.indexOf(openId) : -1;
  const picked = openId ? { id: openId, index: openIndex } : (store.get(key) ?? { id: null, index: 0 });
  const { set: storeSet } = store;
  const setPicked = useCallback((p: Picked) => storeSet(key, p), [storeSet, key]);

  // The open thread stays focused after esc, including when opened by URL.
  useEffect(() => {
    if (openId) storeSet(key, { id: openId, index: openIndex });
  }, [storeSet, openId, openIndex, key]);

  // When the focused thread leaves the list (archived, moved), keep the same
  // position so the next thread takes its place.
  const index = picked.id ? threadIds.indexOf(picked.id) : -1;
  const focusedIndex =
    index >= 0 ? index : threadIds.length ? Math.min(Math.max(picked.index, 0), threadIds.length - 1) : -1;
  const focusedId = focusedIndex >= 0 ? threadIds[focusedIndex] : null;

  const focusAt = useCallback(
    (i: number) => {
      if (!threadIds.length) return;
      const next = Math.min(Math.max(i, 0), threadIds.length - 1);
      setPicked({ id: threadIds[next], index: next });
    },
    [threadIds, setPicked],
  );

  const open = useCallback(
    (id?: string | null) => {
      const target = id ?? focusedId;
      if (target) router.push(mailHref(view, { threadId: target, account }), { scroll: false });
    },
    [router, view, account, focusedId],
  );

  const value = useMemo<MailSelection>(
    () => ({
      view,
      account,
      threadIds,
      focusedId,
      openId,
      target: openId ?? focusedId,
      focus: (id) => focusAt(threadIds.indexOf(id)),
      focusNext: () => focusAt(focusedIndex + 1),
      focusPrev: () => focusAt(focusedIndex - 1),
      open,
      close: () => router.push(mailHref(view, { account }), { scroll: false }),
      go: (next) => router.push(mailHref(next, { account })),
    }),
    [view, account, threadIds, focusedId, focusedIndex, openId, focusAt, open, router],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
