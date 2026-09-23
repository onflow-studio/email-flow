import { cn } from "@/lib/utils";

/** DESIGN.md unread dot: an unread reply in Work, on its row and on the rail count. */
export function UnreadDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full bg-text", className)} />;
}
