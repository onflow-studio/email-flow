import { findCommand, normalizeKeys, type Overrides } from "@/components/mail/keys/commands";

import { db } from ".";
import { keybindings } from "./schema";

/** The stored shortcut overrides. Rows for commands that no longer exist are ignored. */
export async function loadOverrides(): Promise<Overrides> {
  const rows = await db.select({ commandId: keybindings.commandId, keys: keybindings.keys }).from(keybindings);
  const overrides: Overrides = {};
  for (const row of rows) {
    if (!findCommand(row.commandId)) continue;
    overrides[row.commandId] = row.keys.filter((k) => normalizeKeys(k) === k);
  }
  return overrides;
}
