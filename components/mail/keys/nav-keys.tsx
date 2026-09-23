"use client";

import { useRouter } from "next/navigation";

import { RADIO_TOGGLE_EVENT } from "@/components/radio";

import { useMailSelection } from "../selection";
import { VIEWS } from "../views";
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

  // With a thread open, j/k step through threads in reading mode.
  const step = (dir: 1 | -1) => {
    const i = sel.threadIds.indexOf(sel.target ?? "");
    const next = sel.threadIds[i + dir];
    if (sel.openId) {
      if (next) sel.open(next, true);
    } else if (dir === 1) sel.focusNext();
    else sel.focusPrev();
  };

  const bindings: KeyBinding[] = [
    { id: "thread.next", run: () => step(1) },
    { id: "thread.prev", run: () => step(-1) },
    { keys: "arrowdown", when: () => sel.pane === "list", run: () => step(1) },
    { keys: "arrowup", when: () => sel.pane === "list", run: () => step(-1) },
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
    { id: "thread.open", when: () => !!sel.focusedId && sel.focusedId !== sel.openId, run: () => sel.open() },
    { id: "thread.close", when: () => !!sel.openId, run: () => sel.close() },
    ...VIEWS.map<KeyBinding>((v) => ({ id: v.command, run: () => sel.go(v.slug) })),
    { id: "go.settings", run: () => router.push("/settings") },
    { id: "radio", run: () => window.dispatchEvent(new Event(RADIO_TOGGLE_EVENT)) },
    { id: "key-map", run: () => map.setOpen(!map.open) },
  ];

  useKeys(bindings);
  return null;
}
