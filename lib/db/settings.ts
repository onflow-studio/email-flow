import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from ".";
import { settings } from "./schema";

const days = z.number().int().min(1).max(90);
export const staleSettingsSchema = z.object({ workDays: days, replyDays: days, triageDays: days });
export type StaleSettings = z.infer<typeof staleSettingsSchema>;

export const DEFAULT_STALE_SETTINGS: StaleSettings = { workDays: 7, replyDays: 3, triageDays: 3 };

export async function loadStaleSettings(): Promise<StaleSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "stale"));
  const value = row?.value;
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    workDays: days.safeParse(object.workDays).data ?? DEFAULT_STALE_SETTINGS.workDays,
    replyDays: days.safeParse(object.replyDays).data ?? DEFAULT_STALE_SETTINGS.replyDays,
    triageDays: days.safeParse(object.triageDays).data ?? DEFAULT_STALE_SETTINGS.triageDays,
  };
}

export async function saveStaleSettings(value: StaleSettings): Promise<void> {
  const valid = staleSettingsSchema.parse(value);
  await db.insert(settings).values({ key: "stale", value: valid }).onConflictDoUpdate({
    target: settings.key,
    set: { value: valid, updatedAt: new Date() },
  });
}
