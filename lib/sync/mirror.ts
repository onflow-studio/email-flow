import type { Bucket } from "@/lib/db/schema";

// Gmail system labels sync reads.
export const LABEL = {
  inbox: "INBOX",
  unread: "UNREAD",
  trash: "TRASH",
  spam: "SPAM",
  sent: "SENT",
  draft: "DRAFT",
} as const;

export type MirrorState = {
  archived?: boolean;
  trashed: boolean;
  spam: boolean;
  unread: boolean;
};

// Thread state as Gmail sees it, from each message's labels. Drafts don't count.
// `archived` only when the INBOX label means something: our writeback strips INBOX from every
// bucket except inbox, so for news, paper trail, triage and out its absence is our own doing.
export function mirrorState(messageLabels: string[][], bucket: Bucket): MirrorState {
  const live = messageLabels.filter((labels) => !labels.includes(LABEL.draft));
  const every = (label: string) => live.length > 0 && live.every((l) => l.includes(label));
  const some = (label: string) => live.some((l) => l.includes(label));

  const trashed = every(LABEL.trash);
  const state: MirrorState = { trashed, spam: every(LABEL.spam), unread: some(LABEL.unread) };
  if (bucket === "inbox" && !trashed) state.archived = !some(LABEL.inbox);
  return state;
}

// Read state: Gmail unread clears seenAt, Gmail read keeps ours or stamps now.
export function nextSeenAt(unread: boolean, current: Date | null, now: Date): Date | null {
  if (unread) return null;
  return current ?? now;
}

export function isInbound(labelIds: string[], fromEmail: string, accountEmail: string): boolean {
  if (labelIds.includes(LABEL.sent)) return false;
  return fromEmail.toLowerCase() !== accountEmail.toLowerCase();
}

// Placeholder until classify runs: Gmail's own category tabs. Classify overwrites it.
export function initialBucket(threadLabels: string[]): Bucket {
  const labels = new Set(threadLabels);
  if (labels.has("CATEGORY_UPDATES")) return "paper_trail";
  if (labels.has("CATEGORY_PROMOTIONS") || labels.has("CATEGORY_FORUMS") || labels.has("CATEGORY_SOCIAL")) {
    return "news";
  }
  return "inbox";
}
