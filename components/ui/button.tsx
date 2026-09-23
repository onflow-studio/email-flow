import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

import { Kbd } from "./kbd"

const buttonVariants = cva(
  "inline-flex h-touch shrink-0 items-center justify-center gap-2 rounded-sm border border-transparent px-3 text-13 whitespace-nowrap transition-colors duration-80 ease-snap outline-none select-none focus-visible:border-accent disabled:pointer-events-none disabled:text-text-dim md:h-row",
  {
    variants: {
      variant: {
        primary: "bg-accent font-medium text-bg",
        secondary: "border-border bg-transparent text-text hover:bg-surface-raised",
        ghost: "bg-transparent text-text-muted hover:text-text",
        destructive:
          "border-danger bg-transparent text-danger hover:bg-danger hover:text-bg",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

function Button({
  className,
  variant,
  shortcut,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { shortcut?: string }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    >
      {children}
      {shortcut ? <Kbd keys={shortcut} onAccent={variant === "primary"} /> : null}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
