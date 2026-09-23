import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

import { ShortcutKeys } from "./kbd"

/**
 * DESIGN.md button: a label and, when the action has a shortcut, a shortcut
 * segment attached on its right. One box, one hit area; hovering either half
 * affects both. The box carries the label's colors and padding, so
 * `buttonVariants` also styles a plain link.
 */
const buttonVariants = cva(
  "group/button inline-flex h-touch shrink-0 items-center justify-center gap-2 overflow-hidden rounded-sm border whitespace-nowrap transition-colors duration-80 ease-snap outline-none select-none focus-visible:border-accent disabled:pointer-events-none disabled:text-text-dim",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent font-medium text-bg hover:border-accent-hover hover:bg-accent-hover",
        secondary: "border-border bg-transparent text-text hover:bg-surface-raised",
        ghost: "border-transparent bg-transparent text-text-muted hover:border-border hover:text-text",
        // Neutral at rest; red only on hover and keyboard focus. Never filled.
        delete:
          "border-border bg-transparent text-text hover:border-danger hover:text-danger focus-visible:border-danger focus-visible:text-danger",
        "delete-ghost":
          "border-transparent bg-transparent text-text-muted hover:border-danger hover:text-danger focus-visible:border-danger focus-visible:text-danger",
      },
      size: {
        default: "px-3 text-13 md:h-row",
        sm: "px-2 text-12 md:h-6",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

const segmentVariants = cva(
  // Negative margin takes the segment to the box edge through the label padding. Hidden below md, like every key hint.
  "hidden h-full min-w-key items-center justify-center self-stretch border-l px-2 text-11 font-normal transition-colors duration-80 ease-snap md:flex group-disabled/button:text-text-dim",
  {
    variants: {
      variant: {
        primary: "border-bg/40 bg-accent-dim text-text",
        secondary: "border-border bg-surface-raised text-text-muted group-hover/button:bg-surface-top group-hover/button:text-text",
        ghost: "border-border bg-surface-raised text-text-muted group-hover/button:bg-surface-top group-hover/button:text-text",
        delete:
          "border-border bg-surface-raised text-text-muted group-hover/button:bg-surface-top group-hover/button:text-danger group-focus-visible/button:text-danger",
        "delete-ghost":
          "border-border bg-surface-raised text-text-muted group-hover/button:bg-surface-top group-hover/button:text-danger group-focus-visible/button:text-danger",
      },
      size: {
        default: "-mr-3 ml-1",
        sm: "-mr-2",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  shortcut,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { shortcut?: string }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
      {shortcut ? (
        <span className={segmentVariants({ variant, size })}>
          <ShortcutKeys keys={shortcut} />
        </span>
      ) : null}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
