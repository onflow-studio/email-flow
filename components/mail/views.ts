import type { Bucket } from "@/lib/db/schema";

import type { CommandId } from "./keys/commands";

type FixedSlug = "inbox" | "news" | "paper-trail" | "receipts" | "triage" | "work" | "starred" | "snoozed" | "digest" | "sent" | "drafts" | "trash";
/** A project's view lives under /p/<slug>. */
export type ProjectSlug = `p/${string}`;
export type ViewSlug = FixedSlug | ProjectSlug;

/** What the mail views know of a project. */
export type ProjectRef = { id: string; name: string; slug: string };

export type View = {
  slug: ViewSlug;
  label: string;
  /** Set for bucket views; work, starred, snoozed, digest, sent and trash cut across buckets. Drafts lists drafts, not threads. */
  bucket?: Bucket;
  /** Set for a project's view: a bucket the owner named. */
  project?: ProjectRef;
  /** The go-to command; its keys live in the command registry. Projects have none. */
  command?: CommandId;
  /** Rail group: act on now, the owner's projects, later, or the dim bottom of the rail. */
  group: "act" | "projects" | "later" | "bottom";
};

/** In rail order, projects aside. */
export const VIEWS: (View & { command: CommandId })[] = [
  { slug: "triage", command: "go.triage", label: "triage", bucket: "triage", group: "act" },
  { slug: "inbox", command: "go.inbox", label: "inbox", bucket: "inbox", group: "act" },
  { slug: "work", command: "go.work", label: "work", group: "act" },
  { slug: "starred", command: "go.starred", label: "starred", group: "act" },
  { slug: "snoozed", command: "go.snoozed", label: "snoozed", group: "act" },
  { slug: "digest", command: "go.digest", label: "digest", group: "act" },
  { slug: "news", command: "go.news", label: "news", bucket: "news", group: "later" },
  { slug: "paper-trail", command: "go.paper-trail", label: "paper trail", bucket: "paper_trail", group: "later" },
  { slug: "receipts", command: "go.receipts", label: "receipts", bucket: "receipts", group: "later" },
  { slug: "sent", command: "go.sent", label: "sent", group: "bottom" },
  { slug: "drafts", command: "go.drafts", label: "drafts", group: "bottom" },
  { slug: "trash", command: "go.trash", label: "trash", group: "bottom" },
];

export function projectView(p: ProjectRef): View {
  return { slug: `p/${p.slug}`, label: p.name, project: p, group: "projects" };
}

export function findView(slug: string, projects: ProjectRef[] = []): View | undefined {
  return VIEWS.find((v) => v.slug === slug) ?? projects.map(projectView).find((v) => v.slug === slug);
}

export const isProjectSlug = (slug: ViewSlug): slug is ProjectSlug => slug.startsWith("p/");

export function mailHref(view: ViewSlug, opts: { threadId?: string | null } = {}) {
  return opts.threadId ? `/${view}/${opts.threadId}` : `/${view}`;
}
