"use client";

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
    { keys: "j", label: "next thread", group: "navigate", run: () => step(1) },
    { keys: "k", label: "previous thread", group: "navigate", run: () => step(-1) },
    { keys: "arrowdown", label: "down in pane", group: "panes", when: () => sel.pane === "list", run: () => step(1) },
    { keys: "arrowup", label: "up in pane", group: "panes", when: () => sel.pane === "list", run: () => step(-1) },
    {
      keys: "arrowleft",
      label: "pane left",
      group: "panes",
      when: () => isDesktop() && sel.pane !== "rail",
      run: () => sel.setPane(sel.pane === "reading" ? "list" : "rail"),
    },
    {
      keys: "arrowright",
      label: "pane right",
      group: "panes",
      when: () => isDesktop() && sel.pane === "list" && !!sel.focusedId,
      run: () => (sel.focusedId === sel.openId ? sel.setPane("reading") : sel.open()),
    },
    {
      keys: ["enter", "o"],
      label: "open thread",
      group: "navigate",
      when: () => !!sel.focusedId && sel.focusedId !== sel.openId,
      run: () => sel.open(),
    },
    { keys: "escape", label: "back to list", group: "navigate", when: () => !!sel.openId, run: () => sel.close() },
    ...VIEWS.filter((v) => v.goKey).map<KeyBinding>((v) => ({
      keys: `g ${v.goKey}`,
      label: `go to ${v.label}`,
      group: "go",
      run: () => sel.go(v.slug),
    })),
    { keys: "?", label: "show this map", group: "general", run: () => map.setOpen(!map.open) },
  ];

  useKeys(bindings);
  return null;
}
