"use client";

import { cn } from "@/lib/utils";

import { useMailSelection, type Pane } from "./selection";

/** A shell pane that takes keyboard focus on click and shows it with its top hairline on desktop. */
export function FocusPane({
  pane,
  as: Tag,
  className,
  ...props
}: { pane: Exclude<Pane, "rail">; as: "section" | "main" } & React.HTMLAttributes<HTMLElement>) {
  const sel = useMailSelection();
  return (
    <Tag
      {...props}
      data-pane={pane}
      onPointerDown={() => sel.setPane(pane)}
      className={cn(className, sel.pane === pane && "md:pane-focus")}
    />
  );
}
