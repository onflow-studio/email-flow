"use client";

import { useRouter } from "next/navigation";

import { RADIO_TOGGLE_EVENT } from "@/components/radio";
import { LIST_NEXT_PAGE_EVENT } from "../list-pager";

import { stepIntoNextPage, useMailSelection } from "../selection";
import { useViews } from "../work-context";
import { useKeyMap, useKeys, type KeyBinding } from "./keymap";

/** Pane focus is a desktop idea; phone shows one pane at a time. */
export const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

/**
 * Navigation bindings for the shell. Actions and the palette register their own.
 * Arrows act in the focused pane: this handles the list and moving between
 * panes; the rail and the reading pane register their own up and down.
 */
export function NavKeys() {
  const sel = useMailSelection();
  const map = useKeyMap();
  const router = useRouter();
  const views = useViews();

  // With a thread open, j/k step through threads in reading mode. A plain step keeps the picks but ends the shift range.
  const step = (dir: 1 | -1) => {
    sel.endRange();
    const i = sel.threadIds.indexOf(sel.target ?? "");
    const next = sel.threadIds[i + dir];
    if (dir === 1 && i === sel.threadIds.length - 1 && document.querySelector("[data-list-pager]")) {
      if (sel.target) stepIntoNextPage(sel.view, sel.target, !!sel.openId);
      window.dispatchEvent(new Event(LIST_NEXT_PAGE_EVENT));
    }
    if (sel.openId) {
      if (next) sel.open(next, true);
    } else if (dir === 1) sel.focusNext();
    else sel.focusPrev();
  };

  const collapsedHead = () => {
    const k = sel.focusedId ? sel.clusterOf(sel.focusedId) : null;
    return k && sel.isCollapsed(k) ? k : null;
  };

  const bindings: KeyBinding[] = [
    { id: "thread.next", run: () => step(1) },
    { id: "thread.prev", run: () => step(-1) },
    { keys: "arrowdown", when: () => sel.pane === "list", run: () => step(1) },
    { keys: "arrowup", when: () => sel.pane === "list", run: () => step(-1) },
    { keys: "shift+arrowdown", when: () => sel.pane === "list", run: () => sel.extend(1) },
    { keys: "shift+arrowup", when: () => sel.pane === "list", run: () => sel.extend(-1) },
    { id: "thread.pick", when: () => !!sel.focusedId, run: () => {
      const id = sel.focusedId!;
      const group = sel.clusterOf(id);
      if (group && sel.isCollapsed(group)) sel.toggleGroup(sel.allIds.filter((member) => sel.clusterOf(member) === group));
      else sel.toggleSelected(id);
    } },
    { id: "thread.pick-all", when: () => !!sel.allIds.length, run: () => sel.selectAll() },
    {
      id: "pane.left",
      when: () => isDesktop() && sel.pane !== "rail",
      run: () => sel.setPane(sel.pane === "reading" ? "list" : "rail"),
    },
    {
      id: "pane.right",
      when: () => isDesktop() && sel.pane === "list" && !!sel.focusedId,
      run: () => (sel.focusedId === sel.openId ? sel.setPane("reading") : sel.open()),
    },
    // Enter on a collapsed group opens it up; the next enter opens the thread.
    {
      id: "thread.open",
      when: () => !!sel.focusedId && (sel.focusedId !== sel.openId || collapsedHead() !== null),
      run: () => {
        const k = collapsedHead();
        if (k) sel.toggleCluster(k);
        else sel.open();
      },
    },
    { keys: "escape", when: () => sel.selectedIds.length > 0, run: () => sel.clearSelected() },
    { id: "thread.close", when: () => !!sel.openId, run: () => sel.close() },
    ...views.map<KeyBinding>((v) => ({ id: v.command, run: () => sel.go(v.slug) })),
    { id: "go.settings", run: () => router.push("/settings") },
    { id: "radio", run: () => window.dispatchEvent(new Event(RADIO_TOGGLE_EVENT)) },
    { id: "key-map", run: () => map.setOpen(!map.open) },
  ];

  useKeys(bindings);
  return null;
}
