"use client";

import { Button } from "@/components/ui/button";

import { useKeys } from "../keys/keymap";
import { useMailSelection } from "../selection";
import { useCompose } from "./compose";

/** r a f act on the open thread, else the focused row. c starts new mail. */
export function ComposeKeys() {
  const sel = useMailSelection();
  const compose = useCompose();
  const hasTarget = () => !!sel.target;

  useKeys([
    { keys: "c", label: "compose", group: "compose", run: () => compose.open("new", null, sel.account) },
    { keys: "r", label: "reply", group: "compose", when: hasTarget, run: () => compose.open("reply", sel.target) },
    { keys: "a", label: "reply all", group: "compose", when: hasTarget, run: () => compose.open("reply-all", sel.target) },
    { keys: "f", label: "forward", group: "compose", when: hasTarget, run: () => compose.open("forward", sel.target) },
  ]);
  return null;
}

export function ComposeButton() {
  const sel = useMailSelection();
  const compose = useCompose();
  return (
    <Button variant="ghost" shortcut="c" onClick={() => compose.open("new", null, sel.account)} className="h-touch px-2 md:h-6">
      compose
    </Button>
  );
}
