"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { projects, threads } from "@/lib/db/schema";
import { getGmailLabelsAdapter } from "@/lib/gmail/client";
import { resortProjects } from "@/lib/classify/projects";
import { searchThreadIds } from "@/lib/search";
import { enqueueWriteback } from "@/lib/sync/jobs";
import { placeThreads, projectSlug, seedProject } from "@/lib/sync/projects";

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
 * with the threads that label already carries and those a search finds, then sorting reads the
 * rest of the mail back to the chosen point.
 */
/** When sorting starts: all history, a date, or now. Undefined when the form's date is missing or bad. */
function sinceOf(form: FormData): Date | null | undefined {
  const from = String(form.get("from") ?? "all");
  if (from === "new") return new Date();
  if (from !== "since") return null;
  const date = new Date(String(form.get("since") ?? ""));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type SearchPreview = { count: number; subjects: string[] };

/** What a search would put in a project: threads in no project yet, newest first. */
export async function previewSearch(search: string): Promise<SearchPreview> {
  const query = search.trim().slice(0, 500);
  if (!query) return { count: 0, subjects: [] };
  const ids = await searchThreadIds(db, query);
  if (!ids.length) return { count: 0, subjects: [] };
  const free = await db
    .select({ subject: threads.subject })
    .from(threads)
    .where(and(inArray(threads.id, ids), isNull(threads.projectId), eq(threads.trashed, false)))
    .orderBy(desc(threads.lastMessageAt));
  return { count: free.length, subjects: free.slice(0, 3).map((t) => t.subject?.trim() || "(no subject)") };
}

/** Puts the threads a search finds into a project. */
export async function addFromSearch(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const id = String(form.get("project") ?? "");
  const search = String(form.get("search") ?? "").trim().slice(0, 500);
  if (!id || !search) return { ok: false, message: "type a search" };
  const placed = await placeThreads(db, id, await searchThreadIds(db, search));
  refresh();
  return { ok: true, message: placed ? `${placed} ${placed === 1 ? "thread" : "threads"} added` : "nothing new to add" };
}

/** Moves the point sorting reads back to, and sorts again from there. */
export async function setProjectSince(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const id = String(form.get("project") ?? "");
  const since = sinceOf(form);
  if (!id) return null;
  if (since === undefined) return { ok: false, message: "pick a date to sort from" };
  await db.update(projects).set({ since }).where(eq(projects.id, id));
  await resortProjects(db, since);
  refresh();
  return { ok: true, message: "sorting again" };
}

export async function createProject(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const labelName = String(form.get("label") ?? "").trim() || name;
  const search = String(form.get("search") ?? "").trim().slice(0, 500);
  if (!name || name.length > MAX_NAME) return { ok: false, message: `name must be 1 to ${MAX_NAME} characters` };
  if (labelName.length > 225 || RESERVED.test(labelName)) return { ok: false, message: "pick another gmail label" };
  const since = sinceOf(form);
  if (since === undefined) return { ok: false, message: "pick a date to sort from" };

  const [taken] = await db.select({ id: projects.id }).from(projects).where(eq(projects.labelName, labelName));
  if (taken) return { ok: false, message: `a project already uses the label ${labelName}` };
  const [project] = await db.insert(projects).values({ name, slug: await freeSlug(name), labelName, since }).returning();
  const labelled = await seedProject(db, project, getGmailLabelsAdapter);
  const found = search ? await placeThreads(db, project.id, await searchThreadIds(db, search)) : 0;
  const joined = labelled + found;
  await resortProjects(db, since);
  refresh();
  return { ok: true, message: joined ? `${name} made, ${joined} ${joined === 1 ? "thread" : "threads"} in it` : `${name} made` };
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
