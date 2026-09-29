"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { rememberMailPath } from "./return-path";
import { mailHref, type ViewSlug } from "./views";

/** The desktop pane arrow keys act in. Phone has no pane focus. */
export type Pane = "rail" | "list" | "reading";

/**
 * Which thread the keyboard is on. Actions read `target` to know what to act
 * on (the open thread, else the focused row) and call `focusNext` after
 * removing it from the list.
 */
export type MailSelection = {
  view: ViewSlug;
  /** The one account toggled on, when only one is: new mail defaults to it. */
  account: string | null;
  threadIds: string[];
  focusedId: string | null;
  openId: string | null;
  target: string | null;
  /** Focused pane; reading only while a thread is open. */
  pane: Pane;
  setPane: (pane: Pane) => void;
  focus: (id: string) => void;
  /** Picked rows, in list order. Keyboard actions act on them instead of `target`. */
  selectedIds: string[];
  /** Grows or shrinks the shift range by one row from where it started, and moves there. Earlier picks stay. */
  extend: (dir: 1 | -1) => void;
  /** Picks or unpicks one row (its checkbox). */
  toggleSelected: (id: string) => void;
  /** Keeps the picks but ends the shift range: the next shift starts a new one from where you are. */
  endRange: () => void;
  clearSelected: () => void;
  focusNext: () => void;
  focusPrev: () => void;
  /** Opens a thread and focuses the reading pane, unless `keepPane` (stepping from the list). */
  open: (id?: string | null, keepPane?: boolean) => void;
  close: () => void;
  go: (view: ViewSlug) => void;
};

const SelectionContext = createContext<MailSelection | null>(null);

type Picked = { id: string | null; index: number };
/**
 * Picked rows. A shift range grows from `anchor` and adds to `base`, the rows
 * picked before it started, so shrinking it never drops those.
 */
type Range = { anchor: string | null; base: string[]; ids: string[] };
type FocusStore = {
  get: (key: string) => Picked | undefined;
  set: (key: string, picked: Picked) => void;
  /** Stable order of the view you are working in; a view you come back to starts fresh. */
  order: (key: string) => string[] | undefined;
  setOrder: (key: string, ids: string[]) => void;
  /** One range at a time: switching view drops it. */
  range: (key: string) => Range | undefined;
  setRange: (key: string, range: Range | null) => void;
  /** The list's scroll position: the page remounts when the open thread changes, and the list must not move. */
  listScroll: (key: string) => number | undefined;
  setListScroll: (key: string, top: number) => void;
  pane: Pane | null;
  setPane: (pane: Pane) => void;
  /** Records the view shown; true when it differs from the last one (a view switch, not a return to the list). */
  switchedTo: (view: string) => boolean;
  /** A thread opened for you on entering a view: it stays unread a little longer. */
  setAutoOpened: (id: string) => void;
  isAutoOpened: (id: string) => boolean;
  /** Once read, or another thread is open, an auto-opened thread is just a thread. */
  clearAutoOpened: () => void;
};

const FocusStoreContext = createContext<FocusStore | null>(null);

const sameIds = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Keeps rows where they were while you work a view: opening a thread moves it
 * to the seen group on the server, but the list should not jump under the
 * keyboard. Rows that left are dropped. Rows that appeared (new mail, an
 * unsnoozed thread, a twin's shown copy changing) go where the server puts
 * them: just before the first kept row that the server orders after them.
 */
export function stableOrder(prev: string[] | undefined, next: string[]) {
  if (!prev) return next;
  const pos = new Map(next.map((id, i) => [id, i]));
  const out = prev.filter((id) => pos.has(id));
  const kept = new Set(out);
  for (const id of next) {
    if (kept.has(id)) continue;
    const p = pos.get(id)!;
    const before = out.findIndex((other) => pos.get(other)! > p);
    if (before < 0) out.push(id);
    else out.splice(before, 0, id);
  }
  return out;
}

/**
 * Lives in the mail layout. The page remounts when the thread segment
 * changes, so focus and row order are remembered here, per view.
 */
export function FocusStoreProvider({ children }: { children: React.ReactNode }) {
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const [order, setOrderState] = useState<{ key: string; ids: string[] } | null>(null);
  const [range, setRangeState] = useState<(Range & { key: string }) | null>(null);
  const [pane, setPane] = useState<Pane | null>(null);
  const lastViewRef = useRef<string | null>(null);
  const autoOpenedRef = useRef<string | null>(null);
  const switchedTo = useCallback((view: string) => {
    const switched = lastViewRef.current !== view;
    lastViewRef.current = view;
    return switched;
  }, []);
  const setAutoOpened = useCallback((id: string) => {
    autoOpenedRef.current = id;
  }, []);
  const isAutoOpened = useCallback((id: string) => autoOpenedRef.current === id, []);
  const clearAutoOpened = useCallback(() => {
    autoOpenedRef.current = null;
  }, []);
  const set = useCallback((key: string, p: Picked) => setPicked((prev) => ({ ...prev, [key]: p })), []);
  const setOrder = useCallback(
    (key: string, ids: string[]) =>
      setOrderState((prev) => (prev?.key === key && sameIds(prev.ids, ids) ? prev : { key, ids })),
    [],
  );
  const setRange = useCallback(
    (key: string, next: Range | null) => setRangeState(next?.ids.length ? { key, ...next } : null),
    [],
  );
  const listScrollRef = useRef<{ key: string; top: number } | null>(null);
  const listScroll = useCallback(
    (key: string) => (listScrollRef.current?.key === key ? listScrollRef.current.top : undefined),
    [],
  );
  const setListScroll = useCallback((key: string, top: number) => {
    listScrollRef.current = { key, top };
  }, []);
  const value = useMemo<FocusStore>(
    () => ({
      get: (key) => picked[key],
      set,
      order: (key) => (order?.key === key ? order.ids : undefined),
      setOrder,
      range: (key) => (range?.key === key ? range : undefined),
      setRange,
      listScroll,
      setListScroll,
      pane,
      setPane,
      switchedTo,
      setAutoOpened,
      isAutoOpened,
      clearAutoOpened,
    }),
    [picked, order, set, setOrder, range, setRange, listScroll, setListScroll, pane, switchedTo, setAutoOpened, isAutoOpened, clearAutoOpened],
  );
  return <FocusStoreContext.Provider value={value}>{children}</FocusStoreContext.Provider>;
}

export function useAutoOpened() {
  const store = useContext(FocusStoreContext);
  if (!store) throw new Error("useAutoOpened must be used inside <FocusStoreProvider>");
  return { isAutoOpened: store.isAutoOpened, clearAutoOpened: store.clearAutoOpened };
}

export function useListScroll() {
  const store = useContext(FocusStoreContext);
  if (!store) throw new Error("useListScroll must be used inside <FocusStoreProvider>");
  return { listScroll: store.listScroll, setListScroll: store.setListScroll };
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
  const key = view;

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

  const { setPane, switchedTo, setAutoOpened, setRange } = store;
  const range = store.range(key);
  const selectedIds = useMemo(() => {
    const picked = new Set(range?.ids);
    return threadIds.filter((id) => picked.has(id));
  }, [range, threadIds]);

  // Switching view on desktop opens its top thread, without taking the keyboard to it.
  useEffect(() => {
    if (!switchedTo(view)) return;
    const top = threadIds[0];
    if (openId || !top || !window.matchMedia("(min-width: 768px)").matches) return;
    setAutoOpened(top);
    setPane("list");
    router.replace(mailHref(view, { threadId: top }), { scroll: false });
  }, [view, openId, threadIds, switchedTo, setAutoOpened, setPane, router]);

  useEffect(() => rememberMailPath(mailHref(view, { threadId: openId })), [view, openId]);

  // First load: a thread opened by URL is being read.
  const pane: Pane = store.pane === "reading" && !openId ? "list" : (store.pane ?? (openId ? "reading" : "list"));

  const open = useCallback(
    (id?: string | null, keepPane = false) => {
      const target = id ?? focusedId;
      if (!target) return;
      if (!keepPane) setPane("reading");
      router.push(mailHref(view, { threadId: target }), { scroll: false });
    },
    [router, view, focusedId, setPane],
  );

  // The range grows from where it started, so shift+up after shift+down shrinks it.
  const extend = useCallback(
    (dir: 1 | -1) => {
      const current = openId ?? focusedId;
      if (!current) return;
      const from = threadIds.indexOf(current);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= threadIds.length) return;
      const ongoing = !!range?.anchor && threadIds.includes(range.anchor);
      const anchor = ongoing ? range!.anchor! : current;
      const base = ongoing ? range!.base : (range?.ids ?? []);
      const a = threadIds.indexOf(anchor);
      const ids = new Set([...base, ...threadIds.slice(Math.min(a, to), Math.max(a, to) + 1)]);
      setRange(key, { anchor, base, ids: [...ids] });
      // Passing through a thread while picking is not reading it: it waits like an auto-opened one.
      if (openId) {
        setAutoOpened(threadIds[to]);
        open(threadIds[to], true);
      } else focusAt(to);
    },
    [openId, focusedId, threadIds, range, setRange, key, setAutoOpened, open, focusAt],
  );
  const toggleSelected = useCallback(
    (id: string) => {
      const ids = range?.ids.includes(id) ? range.ids.filter((x) => x !== id) : [...(range?.ids ?? []), id];
      setRange(key, { anchor: null, base: ids, ids });
    },
    [range, setRange, key],
  );
  const endRange = useCallback(() => {
    if (range?.anchor) setRange(key, { anchor: null, base: range.ids, ids: range.ids });
  }, [range, setRange, key]);
  const clearSelected = useCallback(() => setRange(key, null), [setRange, key]);

  const value = useMemo<MailSelection>(
    () => ({
      view,
      account,
      threadIds,
      focusedId,
      openId,
      target: openId ?? focusedId,
      pane,
      setPane,
      focus: (id) => focusAt(threadIds.indexOf(id)),
      selectedIds,
      extend,
      toggleSelected,
      endRange,
      clearSelected,
      focusNext: () => focusAt(focusedIndex + 1),
      focusPrev: () => focusAt(focusedIndex - 1),
      open,
      close: () => {
        setPane("list");
        router.push(mailHref(view), { scroll: false });
      },
      go: (next) => router.push(mailHref(next)),
    }),
    [view, account, threadIds, focusedId, focusedIndex, openId, pane, setPane, focusAt, selectedIds, extend, toggleSelected, endRange, clearSelected, open, router],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
