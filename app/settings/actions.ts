"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { ACCOUNT_COLORS } from "@/lib/gmail/colors";

export type SaveState = { ok: boolean; message: string } | null;

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
