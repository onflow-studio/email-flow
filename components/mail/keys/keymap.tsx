"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Kbd } from "@/components/ui/kbd";

import { boundKeys, effectiveKeys, findCommand, type CommandId, type Overrides } from "./commands";

/**
 * One global keydown listener for the mail shell. Features register bindings
 * with `useKeys`. A binding names a command from `commands.ts` by `id`, and its
 * keys are that command's effective keys (defaults plus the user's overrides),
 * so rebinding in settings changes dispatch, buttons and the map together.
 * Local keys that are not commands (arrows in a menu) give `keys` instead.
 *
 * Keys are space-separated sequences of tokens: `j`, `g i`, `mod+k`,
 * `escape`, `?`. Printable keys match `event.key` as typed (so `?` and `J`
 * work without spelling out shift). `mod` is cmd on mac, ctrl elsewhere.
 */
export type KeyBinding = {
  /** The command this runs; its keys come from the registry. */
  id?: CommandId;
  /** Keys for a local binding with no command: one sequence or several aliases, e.g. `["j", "arrowdown"]`. */
  keys?: string | string[];
  run: (event: KeyboardEvent) => void;
  /** Evaluated at keypress time; the binding is skipped when false. */
  when?: () => boolean;
  /** Fire even while an input, textarea or editor has focus. */
  allowInInput?: boolean;
};

export type KeyLayerOptions = {
  /**
   * While mounted, bindings registered before this layer are inactive. Use for
   * modals and the palette so `j` or `e` never leak through to the list.
   */
  exclusive?: boolean;
};

type Layer = {
  exclusive: boolean;
  bindings: () => KeyBinding[];
};

const SEQUENCE_TIMEOUT_MS = 1000;

class KeyRegistry {
  private layers: Layer[] = [];

  add(bindings: () => KeyBinding[], exclusive: boolean) {
    const layer: Layer = { exclusive, bindings };
    this.layers = [...this.layers, layer];
    return () => {
      this.layers = this.layers.filter((l) => l !== layer);
    };
  }

  /** Bindings that can fire now, most recently registered first. */
  active(): KeyBinding[] {
    let start = 0;
    this.layers.forEach((l, i) => {
      if (l.exclusive) start = i;
    });
    return this.layers
      .slice(start)
      .reverse()
      .flatMap((l) => l.bindings());
  }
}

type KeymapContextValue = {
  registry: KeyRegistry;
  overrides: Overrides;
  /** Tokens typed so far in an unfinished sequence, e.g. `["g"]`. */
  pending: string[];
  mapOpen: boolean;
  setMapOpen: (open: boolean) => void;
};

const KeymapContext = createContext<KeymapContextValue | null>(null);

function useKeymapContext() {
  const ctx = useContext(KeymapContext);
  if (!ctx) throw new Error("useKeys must be used inside <KeymapProvider>");
  return ctx;
}

/**
 * The token for a keypress. A printable key without mod or alt is the
 * character typed (`U`, `?`), so shift is implied. With mod or alt, letters
 * and digits come from the physical key (alt+e on mac types `´`) and shift is
 * spelled out: `mod+shift+k`. Named keys spell shift out too: `shift+enter`.
 */
export function tokenFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  const { key, code } = event;
  if (key === "Shift" || key === "Control" || key === "Meta" || key === "Alt" || key === "Dead") {
    return null;
  }
  const mod = event.metaKey || event.ctrlKey;
  const chord = mod || event.altKey;
  const physical = /^(Key[A-Z]|Digit[0-9])$/.test(code ?? "") ? code.slice(-1).toLowerCase() : null;
  let base = key === " " ? "space" : key.length === 1 ? key : key.toLowerCase();
  if (chord && physical) base = physical;
  else if (chord && key.length === 1) base = key.toLowerCase();
  const mods: string[] = [];
  if (mod) mods.push("mod");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey && (chord || base.length > 1)) mods.push("shift");
  return [...mods, base].join("+");
}

const ALIASES: Record<string, string> = { esc: "escape", return: "enter", up: "arrowup", down: "arrowdown" };

function parseSequence(keys: string): string[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((t) => ALIASES[t] ?? t);
}

function sequences(binding: KeyBinding, overrides: Overrides): string[][] {
  const keys = binding.id ? effectiveKeys(binding.id, overrides) : [binding.keys ?? []].flat();
  return keys.map(parseSequence);
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function startsWith(seq: string[], prefix: string[]) {
  return prefix.length <= seq.length && prefix.every((t, i) => seq[i] === t);
}

export function KeymapProvider({ overrides, children }: { overrides: Overrides; children: React.ReactNode }) {
  const [registry] = useState(() => new KeyRegistry());
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);
  const [pending, setPending] = useState<string[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const pendingRef = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function setSequence(next: string[]) {
      pendingRef.current = next;
      setPending(next);
      if (timer.current) clearTimeout(timer.current);
      if (next.length) timer.current = setTimeout(() => setSequence([]), SEQUENCE_TIMEOUT_MS);
    }

    function resolve(typed: string[], inInput: boolean): KeyBinding | "prefix" | null {
      let prefixMatch = false;
      for (const binding of registry.active()) {
        if (inInput && !binding.allowInInput) continue;
        if (binding.when && !binding.when()) continue;
        for (const seq of sequences(binding, overridesRef.current)) {
          if (seq.length === typed.length && startsWith(seq, typed)) return binding;
          if (seq.length > typed.length && startsWith(seq, typed)) prefixMatch = true;
        }
      }
      return prefixMatch ? "prefix" : null;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const token = tokenFromEvent(event);
      if (!token) return;
      const inInput = isEditable(event.target);

      let typed = [...pendingRef.current, token];
      let match = resolve(typed, inInput);
      if (!match && typed.length > 1) {
        typed = [token];
        match = resolve(typed, inInput);
      }

      if (match === "prefix") {
        event.preventDefault();
        setSequence(typed);
      } else if (match) {
        event.preventDefault();
        setSequence([]);
        match.run(event);
      } else if (pendingRef.current.length) {
        setSequence([]);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [registry]);

  const value = useMemo(
    () => ({ registry, overrides, pending, mapOpen, setMapOpen }),
    [registry, overrides, pending, mapOpen],
  );
  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

/**
 * Register bindings for as long as the calling component is mounted. The
 * latest `bindings` array is read at keypress time, so closures stay fresh
 * without re-registering on every render.
 */
export function useKeys(bindings: KeyBinding[], options: KeyLayerOptions = {}) {
  const { registry } = useKeymapContext();
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  const exclusive = options.exclusive ?? false;
  useEffect(() => registry.add(() => ref.current, exclusive), [registry, exclusive]);
}

/** Pending sequence tokens, for the status line hint. */
export function usePendingKeys() {
  return useKeymapContext().pending;
}

export function useKeyMap() {
  const { mapOpen, setMapOpen } = useKeymapContext();
  return { open: mapOpen, setOpen: setMapOpen };
}

/** The user's overrides, for anything that lists commands. */
export function useOverrides() {
  return useKeymapContext().overrides;
}

/** Every key that triggers a command, bound ones first. */
export function useBinding(id: CommandId) {
  return effectiveKeys(id, useKeymapContext().overrides);
}

/** The one key to show on a button: the first bound key, else the first fixed one. Undefined when unbound. */
export function useShortcut(id: CommandId): string | undefined {
  return shortcutOf(id, useKeymapContext().overrides);
}

export function shortcutOf(id: CommandId, overrides: Overrides): string | undefined {
  return boundKeys(id, overrides)[0] ?? findCommand(id)?.fixed?.[0];
}

/** A command's shortcut as keycaps, or nothing when it is unbound. */
export function CommandKbd({ id }: { id: CommandId }) {
  const keys = useShortcut(id);
  return keys ? <Kbd keys={keys} /> : null;
}
