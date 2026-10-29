import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { db } from "@/lib/db";
import { accounts, projects, threads } from "@/lib/db/schema";
import { getGmailLabelsAdapter } from "@/lib/gmail/client";

import { ProjectsSection } from "../projects-section";

export const metadata: Metadata = { title: "projects · settings · email-flow" };

// Gmail's own and the app's bucket labels are never a project's.
const OWN_LABEL = /^(\[|superfer\/|CATEGORY_)/;

/** The owner's own Gmail labels across accounts, for adopting one as a project. An account that fails is skipped. */
async function gmailLabels() {
  const owned = await db.select({ id: accounts.id }).from(accounts);
  const names = new Set<string>();
  await Promise.all(
    owned.map(async (a) => {
      try {
        for (const l of await (await getGmailLabelsAdapter(a.id)).listLabels()) {
          if (/^Label_/.test(l.id) && !OWN_LABEL.test(l.name)) names.add(l.name);
        }
      } catch {
        // Expired access shows on the accounts page; its labels just aren't offered here.
      }
    }),
  );
  return [...names].sort((a, b) => a.localeCompare(b));
}

export default async function ProjectsPage() {
  const [rows, labels] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, slug: projects.slug, labelName: projects.labelName, since: projects.since, threads: count(threads.id) })
      .from(projects)
      .leftJoin(threads, eq(threads.projectId, projects.id))
      .groupBy(projects.id)
      .orderBy(asc(projects.createdAt)),
    gmailLabels(),
  ]);
  const used = new Set(rows.map((p) => p.labelName));
  return (
    <ProjectsSection
      projects={rows.map((p) => ({ ...p, since: p.since?.toISOString() ?? null }))}
      labels={labels.filter((l) => !used.has(l))}
    />
  );
}
