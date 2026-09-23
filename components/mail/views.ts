import type { Bucket } from "@/lib/db/schema";

export type ViewSlug = "inbox" | "news" | "paper-trail" | "triage" | "snoozed" | "trash";

export type View = {
  slug: ViewSlug;
  label: string;
  /** Set for bucket views; snoozed and trash cut across buckets. */
  bucket?: Bucket;
  /** Second key after `g`. */
  goKey?: string;
  /** Rail group: act on now, later, or the dim bottom of the rail. */
  group: "act" | "later" | "bottom";
};

/** In rail order. */
export const VIEWS: View[] = [
  { slug: "triage", label: "triage", bucket: "triage", goKey: "t", group: "act" },
  { slug: "inbox", label: "inbox", bucket: "inbox", goKey: "i", group: "act" },
  { slug: "snoozed", label: "snoozed", group: "act" },
  { slug: "news", label: "news", bucket: "news", goKey: "n", group: "later" },
  { slug: "paper-trail", label: "paper trail", bucket: "paper_trail", goKey: "p", group: "later" },
  { slug: "trash", label: "trash", goKey: "d", group: "bottom" },
];

export function findView(slug: string): View | undefined {
  return VIEWS.find((v) => v.slug === slug);
}

export function mailHref(view: ViewSlug, opts: { threadId?: string | null } = {}) {
  return opts.threadId ? `/${view}/${opts.threadId}` : `/${view}`;
}
