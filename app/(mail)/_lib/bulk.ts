import type { ThreadAction } from "@/lib/actions/types";

/** Actions the palette offers on search results. */
export const BULK_ACTIONS: { key: string; label: string; action: ThreadAction }[] = [
  { key: "archive", label: "archive", action: { type: "archive" } },
  { key: "move-inbox", label: "move to inbox", action: { type: "move", bucket: "inbox" } },
  { key: "move-news", label: "move to news", action: { type: "move", bucket: "news" } },
  { key: "move-paper-trail", label: "move to paper trail", action: { type: "move", bucket: "paper_trail" } },
  { key: "move-receipts", label: "move to receipts", action: { type: "move", bucket: "receipts" } },
  { key: "read", label: "mark read", action: { type: "read" } },
  { key: "work", label: "move to work", action: { type: "work" } },
  { key: "trash", label: "delete", action: { type: "trash" } },
];

/** The bulk actions with a move into each project, after the bucket moves. */
export function bulkActions(projects: { id: string; name: string }[]) {
  const at = BULK_ACTIONS.findIndex((a) => a.key === "move-receipts") + 1;
  return [
    ...BULK_ACTIONS.slice(0, at),
    ...projects.map((p) => ({ key: `project-${p.id}`, label: `move to ${p.name}`, action: { type: "project", projectId: p.id } as ThreadAction })),
    ...BULK_ACTIONS.slice(at),
  ];
}

/** Snooze asks until when first, then previews like the rest. */
export const BULK_SNOOZE = { key: "snooze", label: "snooze" };

/** Keep out decides per sender, so it previews senders. Only Triage threads in the results count. */
export const BULK_KEEP_OUT: { key: string; label: string; spam: boolean }[] = [
  { key: "keep-out", label: "keep out", spam: false },
  { key: "keep-out-spam", label: "keep out as spam", spam: true },
];
