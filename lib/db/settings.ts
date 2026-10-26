import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from ".";
import { settings } from "./schema";

const days = z.number().int().min(1).max(90);
export const staleSettingsSchema = z.object({ workDays: days, replyDays: days, triageDays: days });
export type StaleSettings = z.infer<typeof staleSettingsSchema>;

export const DEFAULT_STALE_SETTINGS: StaleSettings = { workDays: 7, replyDays: 3, triageDays: 3 };

// Any zone Intl accepts, e.g. Europe/Madrid or UTC.
export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const digestSettingsSchema = z.object({
  hour: z.number().int().min(0).max(23),
  timeZone: z.string().min(1).refine(isTimeZone),
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = { hour: 7, timeZone: "UTC" };

async function load(conn: Pick<Db, "select">, key: string): Promise<Record<string, unknown>> {
  const [row] = await conn.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  const value = row?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function loadStaleSettings(conn: Pick<Db, "select">): Promise<StaleSettings> {
  const object = await load(conn, "stale");
  return {
    workDays: days.safeParse(object.workDays).data ?? DEFAULT_STALE_SETTINGS.workDays,
    replyDays: days.safeParse(object.replyDays).data ?? DEFAULT_STALE_SETTINGS.replyDays,
    triageDays: days.safeParse(object.triageDays).data ?? DEFAULT_STALE_SETTINGS.triageDays,
  };
}

export async function saveStaleSettings(conn: Pick<Db, "insert">, value: StaleSettings): Promise<void> {
  const valid = staleSettingsSchema.parse(value);
  await conn.insert(settings).values({ key: "stale", value: valid }).onConflictDoUpdate({
    target: settings.key,
    set: { value: valid, updatedAt: new Date() },
  });
}

/** The saved digest schedule, null when nothing valid has been saved yet. */
export async function savedDigestSettings(conn: Pick<Db, "select">): Promise<DigestSettings | null> {
  return digestSettingsSchema.safeParse(await load(conn, "digest")).data ?? null;
}

export async function loadDigestSettings(conn: Pick<Db, "select">): Promise<DigestSettings> {
  return (await savedDigestSettings(conn)) ?? DEFAULT_DIGEST_SETTINGS;
}

export async function saveDigestSettings(conn: Pick<Db, "insert">, value: DigestSettings): Promise<void> {
  const valid = digestSettingsSchema.parse(value);
  await conn.insert(settings).values({ key: "digest", value: valid }).onConflictDoUpdate({
    target: settings.key,
    set: { value: valid, updatedAt: new Date() },
  });
}
