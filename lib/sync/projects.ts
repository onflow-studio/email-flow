import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { accounts, messages, projectLabels, projects, threads } from "@/lib/db/schema";

import type { GmailLabelsPort } from "./writeback";

// Projects are buckets the owner names, each mirrored to one Gmail label (adopted when it exists).
// The label is read both ways: a thread labelled in Gmail joins the project, and a project thread
// carries the label. See docs/TECH-PLAN.md.

export type ProjectLabelRow = { projectId: string; gmailLabelId: string };

/**
 * Where a thread's Gmail labels put it: a project id, null for out of every project, or undefined
 * for no change. Its own project's label keeps it; another project's label moves it; a missing
 * label takes it out only once that label is known on this account, so a project never loses a
 * thread to an account it has not written to yet.
 */
export function projectFromLabels(labelIds: Iterable<string>, rows: ProjectLabelRow[], current: string | null): string | null | undefined {
  const present = new Set(labelIds);
  const own = rows.find((r) => r.projectId === current);
  if (own && present.has(own.gmailLabelId)) return undefined;
  const other = rows.find((r) => present.has(r.gmailLabelId));
  if (other) return other.projectId;
  if (own) return null;
  return undefined;
}

/** The project labels known on an account. */
export async function accountProjectLabels(db: Pick<Db, "select">, accountId: string): Promise<ProjectLabelRow[]> {
  return db
    .select({ projectId: projectLabels.projectId, gmailLabelId: projectLabels.gmailLabelId })
    .from(projectLabels)
    .where(eq(projectLabels.accountId, accountId));
}

/**
 * Finds the project's label on the account, by name, and remembers its id. With `create`, makes
 * it when the account has none. Null when it is missing and not made.
 */
export async function resolveProjectLabel(
  db: Db,
  project: { id: string; labelName: string },
  accountId: string,
  gmail: Pick<GmailLabelsPort, "listLabels" | "createLabel">,
  { create }: { create: boolean },
): Promise<string | null> {
  const [known] = await db
    .select({ id: projectLabels.gmailLabelId })
    .from(projectLabels)
    .where(and(eq(projectLabels.projectId, project.id), eq(projectLabels.accountId, accountId)));
  if (known) return known.id;
  const found = (await gmail.listLabels()).find((l) => l.name.toLowerCase() === project.labelName.toLowerCase());
  const id = found?.id ?? (create ? (await gmail.createLabel(project.labelName)).id : null);
  if (!id) return null;
  await db.insert(projectLabels).values({ projectId: project.id, accountId, gmailLabelId: id }).onConflictDoNothing();
  return id;
}

/** Every project label id on the account, and the thread's own: what one writeback adds and removes. */
export async function projectLabelState(
  db: Db,
  accountId: string,
  projectId: string | null,
  gmail: Pick<GmailLabelsPort, "listLabels" | "createLabel">,
): Promise<{ own: string | null; all: string[] }> {
  let own: string | null = null;
  if (projectId) {
    const [project] = await db.select({ id: projects.id, labelName: projects.labelName }).from(projects).where(eq(projects.id, projectId));
    if (project) own = await resolveProjectLabel(db, project, accountId, gmail, { create: true });
  }
  const all = (await accountProjectLabels(db, accountId)).map((r) => r.gmailLabelId);
  return { own, all };
}

/**
 * A new project's first threads: every thread already carrying its Gmail label, on every account
 * that has it. They are the owner's own placement, so `since` (which bounds sorting by the app)
 * does not apply: a labelled thread left out would lose its label on its next writeback. Returns
 * how many joined.
 */
export async function seedProject(
  db: Db,
  project: { id: string; labelName: string },
  gmailFor: (accountId: string) => Promise<Pick<GmailLabelsPort, "listLabels" | "createLabel">>,
): Promise<number> {
  let joined = 0;
  for (const account of await db.select({ id: accounts.id }).from(accounts)) {
    // An account Gmail cannot be reached on (access expired) is skipped; its labelled mail joins on the next sync.
    const labelId = await gmailFor(account.id)
      .then((gmail) => resolveProjectLabel(db, project, account.id, gmail, { create: false }))
      .catch(() => null);
    if (!labelId) continue;
    const labelled = sql`exists (select 1 from ${messages} m where m.thread_id = ${threads.id} and ${labelId} = any(m.gmail_labels))`;
    const rows = await db
      .update(threads)
      .set({ projectId: project.id, projectSource: "user" })
      .where(
        and(
          eq(threads.accountId, account.id),
          isNull(threads.projectId),
          labelled,
        ),
      )
      .returning({ id: threads.id, groupId: threads.groupId });
    joined += rows.length;
    // Twin copies in other accounts follow, so the conversation sits in one place.
    const groups = rows.flatMap((r) => (r.groupId ? [r.groupId] : []));
    for (const groupId of groups) {
      await db
        .update(threads)
        .set({ projectId: project.id, projectSource: "user" })
        .where(and(eq(threads.groupId, groupId), or(isNull(threads.projectId), eq(threads.projectId, project.id))));
    }
  }
  return joined;
}

/** A readable address for a project: lowercase words joined by hyphens. */
export function projectSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}
