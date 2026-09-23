"use client";

import { useMailSelection } from "../selection";
import { VIEWS } from "../views";
import { useKeyMap, useKeys, type KeyBinding } from "./keymap";

/** Navigation bindings for the shell. Actions and the palette register their own. */
export function NavKeys() {
  const sel = useMailSelection();
  const map = useKeyMap();

  // With a thread open, j/k step through threads in reading mode.
  const step = (dir: 1 | -1) => {
    const i = sel.threadIds.indexOf(sel.target ?? "");
    const next = sel.threadIds[i + dir];
    if (sel.openId) {
      if (next) sel.open(next);
    } else if (dir === 1) sel.focusNext();
    else sel.focusPrev();
  };

  const bindings: KeyBinding[] = [
    { keys: ["j", "arrowdown"], label: "next thread", group: "navigate", run: () => step(1) },
    { keys: ["k", "arrowup"], label: "previous thread", group: "navigate", run: () => step(-1) },
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
