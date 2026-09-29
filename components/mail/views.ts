import type { Bucket } from "@/lib/db/schema";

import type { CommandId } from "./keys/commands";

export type ViewSlug = "inbox" | "news" | "paper-trail" | "receipts" | "triage" | "work" | "snoozed" | "sent" | "drafts" | "trash";

export type View = {
  slug: ViewSlug;
  label: string;
  /** Set for bucket views; work, snoozed, sent and trash cut across buckets. Drafts lists drafts, not threads. */
  bucket?: Bucket;
  /** The go-to command; its keys live in the command registry. */
  command: CommandId;
  /** Rail group: act on now, later, or the dim bottom of the rail. */
  group: "act" | "later" | "bottom";
};

/** In rail order. */
export const VIEWS: View[] = [
  { slug: "triage", command: "go.triage", label: "triage", bucket: "triage", group: "act" },
  { slug: "inbox", command: "go.inbox", label: "inbox", bucket: "inbox", group: "act" },
  { slug: "work", command: "go.work", label: "work", group: "act" },
  { slug: "snoozed", command: "go.snoozed", label: "snoozed", group: "act" },
  { slug: "news", command: "go.news", label: "news", bucket: "news", group: "later" },
  { slug: "paper-trail", command: "go.paper-trail", label: "paper trail", bucket: "paper_trail", group: "later" },
  { slug: "receipts", command: "go.receipts", label: "receipts", bucket: "receipts", group: "later" },
  { slug: "sent", command: "go.sent", label: "sent", group: "bottom" },
  { slug: "drafts", command: "go.drafts", label: "drafts", group: "bottom" },
  { slug: "trash", command: "go.trash", label: "trash", group: "bottom" },
];

export function findView(slug: string): View | undefined {
  return VIEWS.find((v) => v.slug === slug);
}

export function mailHref(view: ViewSlug, opts: { threadId?: string | null } = {}) {
  return opts.threadId ? `/${view}/${opts.threadId}` : `/${view}`;
}
