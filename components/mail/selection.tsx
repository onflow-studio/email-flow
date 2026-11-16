"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { clusterOrder } from "./clusters";
import { rememberMailPath } from "./return-path";
import { isProjectSlug, mailHref, type ViewSlug } from "./views";

/** The desktop pane arrow keys act in. Phone has no pane focus. */
export type Pane = "rail" | "list" | "reading";

/** A row's group in a view that lists unseen mail first. */
export type SeenGroup = "unseen" | "seen";

/**
 * Views whose server order puts unseen mail first, so their rows fall into
 * unseen and seen groups. Work, the digest, Sent and projects keep their own order.
 */
export const hasSeenGroups = (view: ViewSlug) =>
  view !== "work" && view !== "digest" && view !== "sent" && !isProjectSlug(view);

/**
 * Which thread the keyboard is on. Actions read `target` to know what to act
 * on (the open thread, else the focused row) and call `focusNext` after
 * removing it from the list.
 */
export type MailSelection = {
  view: ViewSlug;
  /** The one account toggled on, when only one is: new mail defaults to it. */
  account: string | null;
  /** Rows the keyboard stops on, in list order: a collapsed group is one stop, its first thread. */
  threadIds: string[];
  /** Every thread in list order, collapsed groups included. */
  allIds: string[];
  /** The group a thread is in, if any. */
  clusterOf: (id: string) => string | null;
  /** True when the group's rows are folded into its first one. */
  isCollapsed: (key: string) => boolean;
  toggleCluster: (key: string) => void;
  /**
   * The group a row was in when the view loaded, or when it arrived: a thread read
   * while you work the view stays in the unseen group. Null in views without groups.
   */
  groupOf: (id: string) => SeenGroup | null;
  /** The section a thread is listed under, if the view has sections. */
  sectionOf: (id: string) => string | null;
  /** True when the section's rows are folded under its header. */
  isSectionCollapsed: (key: string) => boolean;
  toggleSection: (key: string) => void;
  /** What keyboard actions act on: the picks, else a collapsed group's every thread, else `target`. */
  targetIds: string[];
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
  /** Adds a visible-row range without changing the open thread. */
  selectThrough: (id: string) => void;
  toggleGroup: (ids: string[]) => void;
  selectAll: () => void;
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
  /** Each held row's group, kept and dropped with the order. */
  groups: (key: string) => Record<string, SeenGroup> | undefined;
  setOrder: (key: string, ids: string[], groups?: Record<string, SeenGroup>) => void;
  /** One range at a time: switching view drops it. */
  range: (key: string) => Range | undefined;
  setRange: (key: string, range: Range | null) => void;
  /** Groups opened up in a view; every other group stays collapsed. */
  expanded: (key: string) => string[];
  setExpanded: (key: string, clusters: string[]) => void;
  /** Sections folded in a view, remembered in this browser. */
  folded: (key: string) => string[];
  setFolded: (key: string, sections: string[]) => void;
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

const FOLDED_KEY = "superfer.foldedSections";

// Folded sections, per browser. Blocked storage keeps them for the session.
let foldedMemory = "{}";
const foldedListeners = new Set<() => void>();
function readFolded() {
  try {
    return localStorage.getItem(FOLDED_KEY) ?? foldedMemory;
  } catch {
    return foldedMemory;
  }
}
function writeFolded(raw: string) {
  foldedMemory = raw;
  try {
    localStorage.setItem(FOLDED_KEY, raw);
  } catch {
    // Private mode or blocked storage.
  }
  for (const l of foldedListeners) l();
}
function subscribeFolded(l: () => void) {
  foldedListeners.add(l);
  return () => foldedListeners.delete(l);
}

const sameIds = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((id, i) => id === b[i]);
const sameGroups = (a: Record<string, SeenGroup> | undefined, b: Record<string, SeenGroup> | undefined) => {
  if (!a || !b) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
};

/**
 * Each row's group: the one remembered from when the view loaded, else (a row
 * that arrived since) whether it is unseen now. Rows are then listed group by
 * group, so a new row lands at the edge of its group, never among the other.
 * Starred rows keep their order (when each was starred), outside the groups.
 */
export function heldGroups(
  ids: string[],
  prev: Record<string, SeenGroup> | undefined,
  unseen: Set<string>,
  starred: Set<string>,
) {
  const groups: Record<string, SeenGroup> = {};
  for (const id of ids) groups[id] = prev?.[id] ?? (unseen.has(id) ? "unseen" : "seen");
  const rank = (id: string) => (starred.has(id) ? -1 : groups[id] === "unseen" ? 0 : 1);
  const sorted = ids.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((x) => x.id);
  return { ids: sorted, groups };
}

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
  const [order, setOrderState] = useState<{ key: string; ids: string[]; groups?: Record<string, SeenGroup> } | null>(null);
  const [range, setRangeState] = useState<(Range & { key: string }) | null>(null);
  const [pane, setPane] = useState<Pane | null>(null);
  const [expandedState, setExpandedState] = useState<Record<string, string[]>>({});
  const expanded = useCallback((key: string) => expandedState[key] ?? [], [expandedState]);
  const setExpanded = useCallback(
    (key: string, clusters: string[]) => setExpandedState((prev) => ({ ...prev, [key]: clusters })),
    [],
  );
  // The server renders every section open; the browser's saved folds apply after hydration.
  const foldedRaw = useSyncExternalStore(subscribeFolded, readFolded, () => "{}");
  const foldedState = useMemo(() => {
    try {
      const saved: unknown = JSON.parse(foldedRaw);
      return saved && typeof saved === "object" ? (saved as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  }, [foldedRaw]);
  const folded = useCallback((key: string) => foldedState[key] ?? [], [foldedState]);
  const setFolded = useCallback(
    (key: string, sections: string[]) => writeFolded(JSON.stringify({ ...foldedState, [key]: sections })),
    [foldedState],
  );
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
    (key: string, ids: string[], groups?: Record<string, SeenGroup>) =>
      setOrderState((prev) =>
        prev?.key === key && sameIds(prev.ids, ids) && sameGroups(prev.groups, groups) ? prev : { key, ids, groups },
      ),
    [],
  );
  const setRange = useCallback(
    (key: string, next: Range | null) => setRangeState(next ? { key, ...next } : null),
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
      groups: (key) => (order?.key === key ? order.groups : undefined),
      setOrder,
      range: (key) => (range?.key === key ? range : undefined),
      setRange,
      expanded,
      setExpanded,
      folded,
      setFolded,
      listScroll,
      setListScroll,
      pane,
      setPane,
      switchedTo,
      setAutoOpened,
      isAutoOpened,
      clearAutoOpened,
    }),
    [picked, order, set, setOrder, range, setRange, expanded, setExpanded, folded, setFolded, listScroll, setListScroll, pane, switchedTo, setAutoOpened, isAutoOpened, clearAutoOpened],
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
  clusters = {},
  sections = [],
  unseenIds = [],
  openId,
  children,
}: {
  view: ViewSlug;
  account: string | null;
  /** In server order; the list shows them in stable order. */
  threadIds: string[];
  /** Thread id to its group key, for threads in a group. */
  clusters?: Record<string, string>;
  /** Sections in list order, each with its threads; rows are listed section by section. */
  sections?: { key: string; ids: string[] }[];
  /** Threads unseen now; a row's group is taken from this when it first shows. */
  unseenIds?: string[];
  openId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const store = useContext(FocusStoreContext);
  if (!store) throw new Error("SelectionProvider must be used inside <FocusStoreProvider>");
  const key = view;

  const prevOrder = store.order(key);
  const prevGroups = store.groups(key);
  const serverKey = serverIds.join();
  const unseenKey = unseenIds.join();
  const grouping = hasSeenGroups(view);
  const clusterKey = JSON.stringify(clusters);
  const sectionKey = JSON.stringify(sections);
  const sectionOf = useMemo(
    () => new Map((JSON.parse(sectionKey) as typeof sections).flatMap((s) => s.ids.map((id) => [id, s.key] as const))),
    [sectionKey],
  );
  // A group stays together even when new mail joins it. A thread that changes section (a suggestion
  // confirmed) moves under its new header.
  // A row keeps the group it was in when the view loaded, until the view loads again.
  const { allIds, groups } = useMemo(() => {
    const held = stableOrder(prevOrder, serverKey ? serverKey.split(",") : []);
    const starred = new Set(held.filter((id) => sectionOf.get(id) === "starred"));
    const grouped = grouping ? heldGroups(held, prevGroups, new Set(unseenKey ? unseenKey.split(",") : []), starred) : null;
    const ids = clusterOrder(grouped?.ids ?? held, JSON.parse(clusterKey));
    if (!sectionOf.size) return { allIds: ids, groups: grouped?.groups };
    const rank = new Map([...new Set(sectionOf.values())].map((k, i) => [k, i]));
    const at = (id: string) => rank.get(sectionOf.get(id) ?? "") ?? rank.size;
    return {
      allIds: ids.map((id, i) => ({ id, i })).sort((a, b) => at(a.id) - at(b.id) || a.i - b.i).map((x) => x.id),
      groups: grouped?.groups,
    };
  }, [prevOrder, prevGroups, serverKey, unseenKey, grouping, clusterKey, sectionOf]);
  const { setOrder } = store;
  useEffect(() => setOrder(key, allIds, groups), [setOrder, key, allIds, groups]);

  const opened = store.expanded(key);
  const { setExpanded } = store;
  // A group's first thread stands for it while collapsed. Opening any other of its threads opens the group.
  const heads = useMemo(() => {
    const out = new Map<string, string>();
    for (const id of allIds) if (clusters[id] && !out.has(clusters[id])) out.set(clusters[id], id);
    return out;
  }, [allIds, clusters]);
  const collapsed = useCallback(
    (k: string) => !opened.includes(k) && !(openId && clusters[openId] === k && heads.get(k) !== openId),
    [opened, openId, clusters, heads],
  );
  const foldedSections = store.folded(key);
  const { setFolded } = store;
  const sectionCollapsed = useCallback((k: string) => foldedSections.includes(k), [foldedSections]);
  const toggleSection = useCallback(
    (k: string) => setFolded(key, foldedSections.includes(k) ? foldedSections.filter((x) => x !== k) : [...foldedSections, k]),
    [setFolded, key, foldedSections],
  );
  const threadIds = useMemo(
    () =>
      allIds.filter(
        (id) =>
          // A folded section keeps the thread being read.
          (id === openId || !(sectionOf.has(id) && sectionCollapsed(sectionOf.get(id)!))) &&
          (!clusters[id] || !collapsed(clusters[id]) || heads.get(clusters[id]) === id),
      ),
    [allIds, clusters, collapsed, heads, sectionOf, sectionCollapsed, openId],
  );
  const toggleCluster = useCallback(
    (k: string) => setExpanded(key, opened.includes(k) ? opened.filter((x) => x !== k) : [...opened, k]),
    [setExpanded, key, opened],
  );
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
    return allIds.filter((id) => picked.has(id));
  }, [range, allIds]);

  // Switching view on desktop opens its top thread, without taking the keyboard to it.
  useEffect(() => {
    if (!switchedTo(view)) return;
    setRange(key, null);
    const top = threadIds[0];
    if (openId || !top || !window.matchMedia("(min-width: 768px)").matches) return;
    setAutoOpened(top);
    setPane("list");
    router.replace(mailHref(view, { threadId: top }), { scroll: false });
  }, [view, openId, threadIds, switchedTo, setAutoOpened, setPane, setRange, key, router]);

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
      const ids = new Set(base);
      for (const row of threadIds.slice(Math.min(a, to), Math.max(a, to) + 1)) {
        const group = clusters[row];
        if (group && collapsed(group) && heads.get(group) === row) {
          for (const member of allIds) if (clusters[member] === group) ids.add(member);
        } else ids.add(row);
      }
      setRange(key, { anchor, base, ids: [...ids] });
      // Passing through a thread while picking is not reading it: it waits like an auto-opened one.
      if (openId) {
        setAutoOpened(threadIds[to]);
        open(threadIds[to], true);
      } else focusAt(to);
    },
    [openId, focusedId, threadIds, range, setRange, key, setAutoOpened, open, focusAt, clusters, collapsed, heads, allIds],
  );
  const toggleSelected = useCallback(
    (id: string) => {
      const ids = range?.ids.includes(id) ? range.ids.filter((x) => x !== id) : [...(range?.ids ?? []), id];
      setRange(key, { anchor: id, base: ids, ids });
    },
    [range, setRange, key],
  );
  const idsForRow = useCallback((id: string) => {
    const group = clusters[id];
    return group && collapsed(group) && heads.get(group) === id
      ? allIds.filter((other) => clusters[other] === group)
      : [id];
  }, [clusters, collapsed, heads, allIds]);
  const selectThrough = useCallback((id: string) => {
    const to = threadIds.indexOf(id);
    if (to < 0) return;
    const anchor = range?.anchor && threadIds.includes(range.anchor) ? range.anchor : focusedId;
    const from = anchor ? threadIds.indexOf(anchor) : to;
    const ids = new Set(range?.ids ?? []);
    for (const row of threadIds.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      for (const member of idsForRow(row)) ids.add(member);
    }
    setRange(key, { anchor: id, base: [...ids], ids: [...ids] });
  }, [threadIds, range, focusedId, idsForRow, setRange, key]);
  const toggleGroup = useCallback((members: string[]) => {
    const ids = new Set(range?.ids ?? []);
    if (members.every((id) => ids.has(id))) members.forEach((id) => ids.delete(id));
    else members.forEach((id) => ids.add(id));
    setRange(key, { anchor: members[0] ?? null, base: [...ids], ids: [...ids] });
  }, [range, setRange, key]);
  const selectAll = useCallback(() => setRange(key, { anchor: focusedId, base: allIds, ids: allIds }), [allIds, focusedId, setRange, key]);
  const endRange = useCallback(() => {
    if (range?.anchor) setRange(key, { anchor: null, base: range.ids, ids: range.ids });
  }, [range, setRange, key]);
  const clearSelected = useCallback(() => setRange(key, null), [setRange, key]);

  const target = openId ?? focusedId;
  const targetIds = useMemo(() => {
    if (selectedIds.length) return selectedIds;
    if (!target) return [];
    const k = clusters[target];
    return k && collapsed(k) && heads.get(k) === target ? allIds.filter((id) => clusters[id] === k) : [target];
  }, [selectedIds, target, clusters, collapsed, heads, allIds]);

  const value = useMemo<MailSelection>(
    () => ({
      view,
      account,
      threadIds,
      allIds,
      clusterOf: (id) => clusters[id] ?? null,
      groupOf: (id) => groups?.[id] ?? null,
      isCollapsed: collapsed,
      toggleCluster,
      sectionOf: (id) => sectionOf.get(id) ?? null,
      isSectionCollapsed: sectionCollapsed,
      toggleSection,
      targetIds,
      focusedId,
      openId,
      target,
      pane,
      setPane,
      focus: (id) => focusAt(threadIds.indexOf(id)),
      selectedIds,
      extend,
      toggleSelected,
      selectThrough,
      toggleGroup,
      selectAll,
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
    [view, account, threadIds, allIds, groups, clusters, collapsed, toggleCluster, sectionOf, sectionCollapsed, toggleSection, targetIds, target, focusedId, focusedIndex, openId, pane, setPane, focusAt, selectedIds, extend, toggleSelected, selectThrough, toggleGroup, selectAll, endRange, clearSelected, open, router],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
