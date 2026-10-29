"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { projects, threads } from "@/lib/db/schema";
import { getGmailLabelsAdapter } from "@/lib/gmail/client";
import { enqueueWriteback } from "@/lib/sync/jobs";
import { projectSlug, seedProject } from "@/lib/sync/projects";

export type ProjectState = { ok: boolean; message: string } | null;

const MAX_NAME = 60;
const RESERVED = /^(superfer|\[gmail\]|inbox|sent|trash|spam|starred|important|draft|chat)(\/|$)/i;

/** The address a new project's view takes: its name's slug, numbered when taken. */
async function freeSlug(name: string) {
  const base = projectSlug(name);
  const taken = new Set((await db.select({ slug: projects.slug }).from(projects)).map((p) => p.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/**
 * A new project, mirrored to a Gmail label (adopted when an account already has it). It starts
 * with the threads that label already carries, back to the chosen point.
 */
export async function createProject(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const labelName = String(form.get("label") ?? "").trim() || name;
  const from = String(form.get("from") ?? "all");
  if (!name || name.length > MAX_NAME) return { ok: false, message: `name must be 1 to ${MAX_NAME} characters` };
  if (labelName.length > 225 || RESERVED.test(labelName)) return { ok: false, message: "pick another gmail label" };
  const sinceDate = from === "since" ? new Date(String(form.get("since") ?? "")) : null;
  if (from === "since" && (!sinceDate || Number.isNaN(sinceDate.getTime()))) return { ok: false, message: "pick a date to sort from" };
  const since = from === "new" ? new Date() : from === "since" ? sinceDate : null;

  const [taken] = await db.select({ id: projects.id }).from(projects).where(eq(projects.labelName, labelName));
  if (taken) return { ok: false, message: `a project already uses the label ${labelName}` };
  const [project] = await db.insert(projects).values({ name, slug: await freeSlug(name), labelName, since }).returning();
  const joined = await seedProject(db, project, getGmailLabelsAdapter);
  refresh();
  return { ok: true, message: joined ? `${name} made, ${joined} ${joined === 1 ? "thread" : "threads"} from its label` : `${name} made` };
}

export async function renameProject(id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_NAME) return;
  await db.update(projects).set({ name: clean }).where(eq(projects.id, id));
  refresh();
}

/** Its threads go back to their buckets; the Gmail label stays on them, for a project made again. */
export async function deleteProject(id: string) {
  const held = await db.select({ id: threads.id, accountId: threads.accountId }).from(threads).where(eq(threads.projectId, id));
  await db.transaction(async (tx) => {
    await tx.delete(projects).where(eq(projects.id, id));
    for (const t of held) await enqueueWriteback(tx, t);
  });
  refresh();
}
