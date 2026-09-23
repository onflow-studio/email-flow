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
type FocusStore = {
  get: (key: string) => Picked | undefined;
  set: (key: string, picked: Picked) => void;
  /** Stable order of the view you are working in; a view you come back to starts fresh. */
  order: (key: string) => string[] | undefined;
  setOrder: (key: string, ids: string[]) => void;
};

const FocusStoreContext = createContext<FocusStore | null>(null);

const sameIds = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Keeps rows where they were while you work a view: opening a thread moves it
 * to the seen group on the server, but the list should not jump under the
 * keyboard. Rows that left are dropped; rows that appeared go on top.
 */
export function stableOrder(prev: string[] | undefined, next: string[]) {
  if (!prev) return next;
  const present = new Set(next);
  const known = new Set(prev);
  return [...next.filter((id) => !known.has(id)), ...prev.filter((id) => present.has(id))];
}

/**
 * Lives in the mail layout. The page remounts when the thread segment
 * changes, so focus and row order are remembered here, per view and account.
 */
export function FocusStoreProvider({ children }: { children: React.ReactNode }) {
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const [order, setOrderState] = useState<{ key: string; ids: string[] } | null>(null);
  const set = useCallback((key: string, p: Picked) => setPicked((prev) => ({ ...prev, [key]: p })), []);
  const setOrder = useCallback(
    (key: string, ids: string[]) =>
      setOrderState((prev) => (prev?.key === key && sameIds(prev.ids, ids) ? prev : { key, ids })),
    [],
  );
  const value = useMemo<FocusStore>(
    () => ({ get: (key) => picked[key], set, order: (key) => (order?.key === key ? order.ids : undefined), setOrder }),
    [picked, order, set, setOrder],
  );
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
  threadIds: serverIds,
  openId,
  children,
}: {
  view: ViewSlug;
  account: string | null;
  /** In server order; the list shows them in stable order. */
  threadIds: string[];
  openId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const store = useContext(FocusStoreContext);
  if (!store) throw new Error("SelectionProvider must be used inside <FocusStoreProvider>");
  const key = `${view}:${account ?? "all"}`;

  const prevOrder = store.order(key);
  const serverKey = serverIds.join();
  const threadIds = useMemo(
    () => stableOrder(prevOrder, serverKey ? serverKey.split(",") : []),
    [prevOrder, serverKey],
  );
  const { setOrder } = store;
  useEffect(() => setOrder(key, threadIds), [setOrder, key, threadIds]);
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
