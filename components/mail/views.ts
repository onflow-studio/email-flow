import type { Bucket } from "@/lib/db/schema";

export type ViewSlug = "inbox" | "news" | "paper-trail" | "triage" | "snoozed" | "set-aside" | "trash";

export type View = {
  slug: ViewSlug;
  label: string;
  /** Set for bucket views; snoozed, set aside and trash cut across buckets. */
  bucket?: Bucket;
  /** Second key after `g`. */
  goKey?: string;
};

export const VIEWS: View[] = [
  { slug: "inbox", label: "inbox", bucket: "inbox", goKey: "i" },
  { slug: "news", label: "news", bucket: "news", goKey: "n" },
  { slug: "paper-trail", label: "paper trail", bucket: "paper_trail", goKey: "p" },
  { slug: "triage", label: "triage", bucket: "triage", goKey: "t" },
  { slug: "snoozed", label: "snoozed" },
  { slug: "set-aside", label: "set aside" },
  { slug: "trash", label: "trash" },
];

export function findView(slug: string): View | undefined {
  return VIEWS.find((v) => v.slug === slug);
}

export function mailHref(view: ViewSlug, opts: { threadId?: string | null; account?: string | null } = {}) {
  const path = opts.threadId ? `/${view}/${opts.threadId}` : `/${view}`;
  return opts.account ? `${path}?account=${opts.account}` : path;
}
