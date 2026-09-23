"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  findCommand,
  isReserved,
  normalizeKeys,
  validOverrides,
  type Overrides,
} from "@/components/mail/keys/commands";
import { db } from "@/lib/db";
import { loadOverrides } from "@/lib/db/keybindings";
import { keybindings } from "@/lib/db/schema";

export type SaveResult = { ok: true; overrides: Overrides } | { ok: false; message: string };

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Applies shortcut changes together: command id to its new keys, or null to
 * reset to the default. Only differences from the defaults are stored, and the
 * result is refused whole if it leaves a clash or binds a reserved key.
 */
export async function saveKeybindings(changes: Record<string, string[] | null>): Promise<SaveResult> {
  const current = await loadOverrides();
  const next: Overrides = { ...current };
  for (const [id, keys] of Object.entries(changes)) {
    const command = findCommand(id);
    if (!command) return { ok: false, message: "unknown command, reload" };
    if (keys === null) {
      delete next[id];
      continue;
    }
    const clean = keys.map(normalizeKeys);
    if (clean.some((k) => !k)) return { ok: false, message: "unreadable key, try again" };
    const reserved = clean.find((k) => isReserved(k!));
    if (reserved) return { ok: false, message: `${reserved} is reserved` };
    if (same(clean as string[], command.keys)) delete next[id];
    else next[id] = clean as string[];
  }
  if (!validOverrides(next)) return { ok: false, message: "two actions would share a key" };

  const ids = Object.keys(changes);
  await db.transaction(async (tx) => {
    await tx.delete(keybindings).where(inArray(keybindings.commandId, ids));
    const rows = ids.flatMap((id) => (next[id] ? [{ commandId: id, keys: next[id] }] : []));
    if (rows.length) await tx.insert(keybindings).values(rows);
  });

  // The mail shell reads the bindings in its layout.
  revalidatePath("/", "layout");
  return { ok: true, overrides: next };
}

export async function resetKeybindings(): Promise<SaveResult> {
  await db.delete(keybindings);
  revalidatePath("/", "layout");
  return { ok: true, overrides: {} };
}
