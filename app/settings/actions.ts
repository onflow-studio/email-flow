"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { digestSettingsSchema, saveDigestSettings, saveStaleSettings, staleSettingsSchema } from "@/lib/db/settings";
import { ACCOUNT_COLORS } from "@/lib/gmail/colors";

export type SaveState = { ok: boolean; message: string } | null;

export async function saveDigest(_prev: SaveState, form: FormData): Promise<SaveState> {
  const parsed = staleSettingsSchema.safeParse({
    workDays: Number(form.get("workDays")),
    replyDays: Number(form.get("replyDays")),
    triageDays: Number(form.get("triageDays")),
  });
  if (!parsed.success) return { ok: false, message: "enter whole days from 1 to 90" };
  const hour = String(form.get("hour") ?? "").trim();
  const schedule = digestSettingsSchema.safeParse({
    hour: hour === "" ? NaN : Number(hour),
    timeZone: String(form.get("timeZone") ?? "").trim(),
  });
  if (!schedule.success) {
    return { ok: false, message: schedule.error.issues.some((i) => i.path[0] === "hour") ? "enter an hour from 0 to 23" : "enter a time zone like Europe/Madrid or UTC" };
  }
  await saveStaleSettings(db, parsed.data);
  await saveDigestSettings(db, schedule.data);
  refresh();
  return { ok: true, message: "saved" };
}

const MAX_LABEL = 32;
const MAX_SIGNATURE = 20_000;

export async function saveAccount(_prev: SaveState, form: FormData): Promise<SaveState> {
  const id = String(form.get("id") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const color = String(form.get("color") ?? "");
  const signature = String(form.get("signatureHtml") ?? "");

  if (!label || label.length > MAX_LABEL) {
    return { ok: false, message: `label must be 1 to ${MAX_LABEL} characters` };
  }
  if (!ACCOUNT_COLORS.some((c) => c.hex === color)) {
    return { ok: false, message: "pick one of the account colors" };
  }
  if (signature.length > MAX_SIGNATURE) {
    return { ok: false, message: "signature too long" };
  }

  const updated = await db
    .update(accounts)
    .set({ label, color, signatureHtml: signature.trim() || null })
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id });
  if (updated.length === 0) return { ok: false, message: "account not found, reload" };

  refresh();
  return { ok: true, message: "saved" };
}
