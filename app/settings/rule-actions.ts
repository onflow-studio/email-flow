"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import { parseRule, type RuleStructure } from "@/lib/ai/rules";
import { db } from "@/lib/db";
import { rules } from "@/lib/db/schema";

export type RuleState = { ok: boolean; message: string } | null;

const MIN_RULE = 3;
const MAX_RULE = 500;

async function tryParse(text: string): Promise<RuleStructure | null> {
  try {
    return await parseRule(text);
  } catch (error) {
    console.error("rule parse failed", error);
    return null;
  }
}

export async function addRule(_prev: RuleState, form: FormData): Promise<RuleState> {
  const text = String(form.get("text") ?? "").trim().replace(/\s+/g, " ");
  if (text.length < MIN_RULE || text.length > MAX_RULE) {
    return { ok: false, message: `rule must be ${MIN_RULE} to ${MAX_RULE} characters` };
  }
  const structured = await tryParse(text);
  await db.insert(rules).values({ text, structured });
  refresh();
  return structured
    ? { ok: true, message: "rule added" }
    : { ok: false, message: "rule added as plain text, parse failed. classify still reads it" };
}

export async function reparseRule(id: string) {
  const [rule] = await db.select({ text: rules.text }).from(rules).where(eq(rules.id, id));
  if (!rule) return;
  const structured = await tryParse(rule.text);
  if (structured) await db.update(rules).set({ structured }).where(eq(rules.id, id));
  refresh();
}

export async function setRuleEnabled(id: string, enabled: boolean) {
  await db.update(rules).set({ enabled }).where(eq(rules.id, id));
  refresh();
}

export async function deleteRule(id: string) {
  await db.delete(rules).where(eq(rules.id, id));
  refresh();
}
