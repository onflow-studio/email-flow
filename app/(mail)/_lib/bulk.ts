import type { ThreadAction } from "@/lib/actions/types";

/** Actions the palette offers on search results. */
export const BULK_ACTIONS: { key: string; label: string; action: ThreadAction }[] = [
  { key: "archive", label: "archive", action: { type: "archive" } },
  { key: "move-inbox", label: "move to inbox", action: { type: "move", bucket: "inbox" } },
  { key: "move-news", label: "move to news", action: { type: "move", bucket: "news" } },
  { key: "move-paper-trail", label: "move to paper trail", action: { type: "move", bucket: "paper_trail" } },
  { key: "read", label: "mark read", action: { type: "read" } },
  { key: "work", label: "move to work", action: { type: "work" } },
  { key: "trash", label: "delete", action: { type: "trash" } },
];
