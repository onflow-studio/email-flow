/**
 * Every bindable command in the app, with its default keys. Defaults live
 * here, in code; the database stores only the user's overrides, keyed by
 * these ids, so an id is a stable name and must never be renamed.
 *
 * Keys use the keymap notation: space-separated steps (`g i`), `+` within a
 * step (`mod+k`, `shift+enter`). Printable keys are as typed, so `U` and `?`
 * need no `shift`.
 */

export type Scope = "mail" | "compose";

export const GROUPS = ["navigate", "act on a thread", "triage", "write", "general", "compose"] as const;
export type Group = (typeof GROUPS)[number];

export type Command = {
  id: string;
  label: string;
  group: Group;
  /** Where the binding listens. Mail and compose never listen at once: compose is an exclusive layer. */
  scope: Scope;
  /** Default keys, rebindable. Empty means bindable but unbound by default. */
  keys: string[];
  /** Keys that always work and cannot be rebound or taken. */
  fixed?: string[];
};

const go = <T extends string>(id: T, label: string, keys: string[] = []) =>
  ({ id: `go.${id}`, label: `go to ${label}`, group: "navigate", scope: "mail", keys }) as const satisfies Command;

export const COMMANDS = [
  { id: "thread.next", label: "next thread", group: "navigate", scope: "mail", keys: ["j"] },
  { id: "thread.prev", label: "previous thread", group: "navigate", scope: "mail", keys: ["k"] },
  { id: "thread.open", label: "open thread", group: "navigate", scope: "mail", keys: ["o"], fixed: ["enter"] },
  { id: "thread.close", label: "back to list", group: "navigate", scope: "mail", keys: [], fixed: ["escape"] },
  { id: "pane.move", label: "move in pane", group: "navigate", scope: "mail", keys: [], fixed: ["arrowup", "arrowdown"] },
  { id: "pane.left", label: "pane left", group: "navigate", scope: "mail", keys: [], fixed: ["arrowleft"] },
  { id: "pane.right", label: "pane right", group: "navigate", scope: "mail", keys: [], fixed: ["arrowright"] },
  go("triage", "triage", ["g t"]),
  go("inbox", "inbox", ["g i"]),
  go("snoozed", "snoozed"),
  go("news", "news", ["g n"]),
  go("paper-trail", "paper trail", ["g p"]),
  go("trash", "trash", ["g d"]),
  go("settings", "settings"),

  { id: "archive", label: "archive", group: "act on a thread", scope: "mail", keys: ["e"] },
  { id: "snooze", label: "snooze", group: "act on a thread", scope: "mail", keys: ["s"] },
  { id: "pin", label: "pin", group: "act on a thread", scope: "mail", keys: ["h"] },
  { id: "delete", label: "delete", group: "act on a thread", scope: "mail", keys: ["#"] },
  { id: "spam", label: "mark spam", group: "act on a thread", scope: "mail", keys: ["!"] },
  { id: "unread", label: "mark unread", group: "act on a thread", scope: "mail", keys: ["U"] },
  { id: "unsubscribe", label: "unsubscribe", group: "act on a thread", scope: "mail", keys: ["u"] },

  { id: "let-in", label: "let in", group: "triage", scope: "mail", keys: ["i"] },
  { id: "keep-out", label: "keep out", group: "triage", scope: "mail", keys: ["x"] },
  { id: "move", label: "move to…", group: "triage", scope: "mail", keys: ["m"] },
  { id: "move.inbox", label: "move to inbox", group: "triage", scope: "mail", keys: [] },
  { id: "move.news", label: "move to news", group: "triage", scope: "mail", keys: [] },
  { id: "move.paper_trail", label: "move to paper trail", group: "triage", scope: "mail", keys: [] },

  { id: "compose", label: "compose", group: "write", scope: "mail", keys: ["c"] },
  { id: "reply", label: "reply", group: "write", scope: "mail", keys: ["r"] },
  { id: "reply-all", label: "reply all", group: "write", scope: "mail", keys: ["a"] },
  { id: "forward", label: "forward", group: "write", scope: "mail", keys: ["f"] },

  { id: "palette", label: "palette", group: "general", scope: "mail", keys: ["mod+k"] },
  { id: "search", label: "search", group: "general", scope: "mail", keys: ["/"] },
  { id: "undo", label: "undo last", group: "general", scope: "mail", keys: ["z"], fixed: ["mod+z"] },
  { id: "key-map", label: "open key map", group: "general", scope: "mail", keys: ["?"] },
  { id: "radio", label: "toggle radio", group: "general", scope: "mail", keys: [] },

  { id: "compose.send", label: "send", group: "compose", scope: "compose", keys: [], fixed: ["mod+enter"] },
  { id: "compose.close", label: "close compose", group: "compose", scope: "compose", keys: [], fixed: ["escape"] },
  { id: "compose.link", label: "link", group: "compose", scope: "compose", keys: ["mod+k"] },
] as const satisfies readonly Command[];

export type CommandId = (typeof COMMANDS)[number]["id"];

const BY_ID = new Map<string, Command>(COMMANDS.map((c) => [c.id, c]));

export function findCommand(id: string): Command | undefined {
  return BY_ID.get(id);
}

/** Overrides: command id to its keys. An empty list unbinds it. Commands not listed use their defaults. */
export type Overrides = Partial<Record<string, string[]>>;

/** The rebindable keys in effect, without the fixed ones. */
export function boundKeys(id: CommandId, overrides: Overrides): string[] {
  return overrides[id] ?? [...(BY_ID.get(id)?.keys ?? [])];
}

/** Everything that triggers the command: the bound keys, then the fixed ones. */
export function effectiveKeys(id: CommandId, overrides: Overrides): string[] {
  return [...boundKeys(id, overrides), ...(BY_ID.get(id)?.fixed ?? [])];
}

/**
 * Keys nothing can be bound to: the structural keys (esc leaves, enter opens
 * and submits in inputs, arrows move, tab walks focus), every command's fixed
 * keys, and the editing and browser combos a mail app must not steal.
 */
export const RESERVED = [
  "escape",
  "enter",
  "tab",
  "space",
  "backspace",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "mod+enter",
  "mod+z",
  "mod+a",
  "mod+c",
  "mod+v",
  "mod+x",
  "mod+l",
  "mod+r",
  "mod+t",
  "mod+w",
  "mod+q",
];

const RESERVED_SET = new Set<string>([...RESERVED, ...(COMMANDS as readonly Command[]).flatMap((c) => c.fixed ?? [])]);

/** A sequence is reserved when any of its steps is. */
export function isReserved(keys: string) {
  return keys.split(" ").some((step) => RESERVED_SET.has(step));
}

const MODS = ["mod", "alt", "shift"];

/** Checks and tidies a stored or recorded sequence: one or two steps, modifiers first. Null when malformed. */
export function normalizeKeys(keys: string): string | null {
  const steps = keys.trim().split(/\s+/).filter(Boolean);
  if (!steps.length || steps.length > 2) return null;
  const out: string[] = [];
  for (const step of steps) {
    const parts = step === "+" ? ["+"] : step.split("+");
    const base = parts.at(-1);
    const mods = parts.slice(0, -1);
    if (!base || mods.some((m) => !MODS.includes(m)) || new Set(mods).size !== mods.length) return null;
    if (MODS.includes(base) || base.length > 12) return null;
    out.push([...MODS.filter((m) => mods.includes(m)), base].join("+"));
  }
  return out.join(" ");
}

function prefixes(a: string, b: string) {
  const x = a.split(" ");
  const y = b.split(" ");
  const n = Math.min(x.length, y.length);
  return x.slice(0, n).join(" ") === y.slice(0, n).join(" ");
}

/**
 * Commands whose bound keys clash with `keys` for `id`: the same sequence, or
 * one that starts the other (`g` against `g i`), which would make one of them
 * unreachable. Only commands that listen in the same scope clash.
 */
export function conflictsFor(id: CommandId, keys: string, overrides: Overrides): CommandId[] {
  const scope = BY_ID.get(id)?.scope;
  return COMMANDS.filter(
    (c) => c.id !== id && c.scope === scope && boundKeys(c.id, overrides).some((k) => prefixes(k, keys)),
  ).map((c) => c.id);
}

/** True when no two commands in a scope clash and nothing binds a reserved key. */
export function validOverrides(overrides: Overrides): boolean {
  for (const c of COMMANDS) {
    for (const k of boundKeys(c.id, overrides)) {
      if (normalizeKeys(k) !== k || isReserved(k)) return false;
      if (conflictsFor(c.id, k, overrides).length) return false;
    }
  }
  return true;
}
