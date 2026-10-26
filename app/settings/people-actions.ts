"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import {
  answerQuestion as answer,
  deleteEntity as remove,
  dismissQuestion as dismiss,
  mergeEntities as merge,
  renameEntity as rename,
  setAliases as aliases,
  setSummary as summary,
  unlinkThread as unlink,
  normalizeName,
} from "@/lib/sync/entities";

export type EditState = { error: string } | null;

export async function renameEntity(id: string, _state: EditState, form: FormData): Promise<EditState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!normalizeName(name) || name.length > 120) return { error: "name must be 1 to 120 characters" };
  await rename(db, id, name);
  refresh();
  return null;
}

export async function setAliases(id: string, _state: EditState, form: FormData): Promise<EditState> {
  const values = String(form.get("aliases") ?? "").split(",").map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (values.length > 20 || values.some((value) => value.length > 120)) return { error: "use at most 20 aliases of up to 120 characters" };
  await aliases(db, id, values);
  refresh();
  return null;
}

export async function setSummary(id: string, _state: EditState, form: FormData): Promise<EditState> {
  const value = String(form.get("summary") ?? "").trim();
  if (value.length > 500) return { error: "summary must be at most 500 characters" };
  await summary(db, id, value || null);
  refresh();
  return null;
}

export async function mergeEntities(loserId: string, winnerId: string) {
  await merge(db, winnerId, loserId);
  refresh();
  redirect(`/settings/people/${winnerId}`);
}

export async function deleteEntity(id: string) {
  await remove(db, id);
  refresh();
  redirect("/settings/people");
}

export async function unlinkThread(entityId: string, threadId: string) {
  await unlink(db, entityId, threadId);
  refresh();
}

export async function answerQuestion(id: string, same: boolean) {
  await answer(db, id, same);
  refresh();
}

export async function dismissQuestion(id: string) {
  await dismiss(db, id);
  refresh();
}
