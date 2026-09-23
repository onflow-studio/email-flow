import { cn } from "@/lib/utils";

/** An account's identity: 8px square in its hue, hollow while the account is toggled off. */
export function AccountSquare({ color, off = false, className }: { color?: string; off?: boolean; className?: string }) {
  const hue = color ?? "var(--text-dim)";
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0", className)}
      style={off ? { border: `1px solid ${hue}` } : { backgroundColor: hue }}
    />
  );
}
