import { cn } from "@/lib/utils"

const NAMES: Record<string, string> = { escape: "esc", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" }

/**
 * A shortcut as keycaps, in the keymap's own notation: space-separated steps
 * (`g i`), `+` within a step (`mod+k`). Hidden below md, where there is no keyboard.
 */
function Kbd({
  keys,
  onAccent = false,
  className,
}: {
  keys: string
  /** On an `--accent` fill, e.g. the primary button. */
  onAccent?: boolean
  className?: string
}) {
  const steps = keys.split(/\s+/).filter(Boolean)
  return (
    <span className={cn("hidden items-center gap-1 md:inline-flex", className)}>
      {steps.map((step, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {step.split("+").map((key, j) => (
            <kbd
              key={j}
              className={cn(
                "inline-flex h-key min-w-key items-center justify-center rounded-sm border px-1 font-mono text-11 leading-none font-normal",
                onAccent ? "border-bg/40 bg-transparent text-bg" : "border-border bg-surface-raised text-text-muted"
              )}
            >
              {NAMES[key] ?? key}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}

/** The keys inside a button's shortcut segment: bare text, so combos sit 4px apart and sequences 8px. */
function ShortcutKeys({ keys }: { keys: string }) {
  return (
    <span className="inline-flex items-center gap-2 leading-none">
      {keys
        .split(/\s+/)
        .filter(Boolean)
        .map((step, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {step.split("+").map((key, j) => (
              <kbd key={j} className="font-mono">
                {NAMES[key] ?? key}
              </kbd>
            ))}
          </span>
        ))}
    </span>
  )
}

/** A row of `keys label` hints. An array of keys means alternatives, shown as `j/k`. */
function KeyHints({
  hints,
  className,
}: {
  hints: [keys: string | string[], label: string][]
  className?: string
}) {
  return (
    <span className={cn("hidden items-center gap-3 md:flex", className)}>
      {hints.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1 whitespace-nowrap">
          {[keys].flat().map((k, i) => (
            <span key={k} className="flex items-center gap-1">
              {i > 0 ? <span className="text-text-dim">/</span> : null}
              <Kbd keys={k} />
            </span>
          ))}
          {label}
        </span>
      ))}
    </span>
  )
}

export { Kbd, KeyHints, ShortcutKeys }
