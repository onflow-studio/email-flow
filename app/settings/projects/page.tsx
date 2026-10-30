import { asc, sql } from "drizzle-orm";
import type { Metadata } from "next";

import { db } from "@/lib/db";
import { accounts, messages, projects, threads } from "@/lib/db/schema";
import { getGmailLabelsAdapter } from "@/lib/gmail/client";

import { ProjectsSection } from "../projects-section";

export const metadata: Metadata = { title: "projects · settings · email-flow" };

// Gmail's own and the app's bucket labels are never a project's.
const OWN_LABEL = /^(\[|superfer\/|CATEGORY_)/;

/**
 * The owner's own Gmail labels across accounts, for adopting one as a project, each with the threads
 * it is on here. An account that fails is skipped.
 */
async function gmailLabels() {
  const owned = await db.select({ id: accounts.id }).from(accounts);
  const nameOf = new Map<string, string>();
  await Promise.all(
    owned.map(async (a) => {
      try {
        for (const l of await (await getGmailLabelsAdapter(a.id)).listLabels()) {
          if (/^Label_/.test(l.id) && !OWN_LABEL.test(l.name)) nameOf.set(`${a.id}:${l.id}`, l.name);
        }
      } catch {
        // Expired access shows on the accounts page; its labels just aren't offered here.
      }
    }),
  );
  const counts = await db.execute<{ account_id: string; label: string; threads: number }>(sql`
    select ${messages.accountId} as account_id, l.label, count(distinct ${messages.threadId})::int as threads
    from ${messages}, unnest(${messages.gmailLabels}) as l(label)
    where l.label like 'Label\_%'
    group by 1, 2`);
  const total = new Map<string, number>([...new Set(nameOf.values())].map((n) => [n, 0]));
  for (const r of counts) {
    const name = nameOf.get(`${r.account_id}:${r.label}`);
    if (name) total.set(name, (total.get(name) ?? 0) + r.threads);
  }
  return [...total].map(([name, threads]) => ({ name, threads })).sort((a, b) => a.name.localeCompare(b.name));
}

export default async function ProjectsPage() {
  const [rows, labels] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        labelName: projects.labelName,
        since: projects.since,
        live: sql<number>`count(*) filter (where ${threads.projectId} = ${projects.id} and not ${threads.archived})::int`,
        archived: sql<number>`count(*) filter (where ${threads.projectId} = ${projects.id} and ${threads.archived})::int`,
        toCheck: sql<number>`count(*) filter (where ${threads.projectId} is null and not ${threads.archived})::int`,
      })
      .from(projects)
      .leftJoin(
        threads,
        sql`(${threads.projectId} = ${projects.id} or ${threads.projectSuggestedId} = ${projects.id}) and not ${threads.trashed} and not ${threads.spam}`,
      )
      .groupBy(projects.id)
      .orderBy(asc(projects.createdAt)),
    gmailLabels(),
  ]);
  const used = new Set(rows.map((p) => p.labelName));
  return (
    <ProjectsSection
      projects={rows.map((p) => ({ ...p, since: p.since?.toISOString() ?? null }))}
      labels={labels.filter((l) => !used.has(l.name))}
    />
  );
}
