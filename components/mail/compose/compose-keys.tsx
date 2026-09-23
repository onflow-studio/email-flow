"use client";

import { Button } from "@/components/ui/button";

import { useKeys, useShortcut } from "../keys/keymap";
import { useMailSelection } from "../selection";
import { useCompose } from "./compose";

/** r a f act on the open thread, else the focused row. c starts new mail. */
export function ComposeKeys() {
  const sel = useMailSelection();
  const compose = useCompose();
  const hasTarget = () => !!sel.target;

  useKeys([
    { id: "compose", run: () => compose.open("new", null, sel.account) },
    { id: "reply", when: hasTarget, run: () => compose.open("reply", sel.target) },
    { id: "reply-all", when: hasTarget, run: () => compose.open("reply-all", sel.target) },
    { id: "forward", when: hasTarget, run: () => compose.open("forward", sel.target) },
  ]);
  return null;
}

export function ComposeButton() {
  const sel = useMailSelection();
  const compose = useCompose();
  const shortcut = useShortcut("compose");
  return (
    <Button variant="ghost" size="sm" shortcut={shortcut} onClick={() => compose.open("new", null, sel.account)}>
      compose
    </Button>
  );
}
