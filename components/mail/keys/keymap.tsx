"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * One global keydown listener for the mail shell. Features register bindings
 * with `useKeys`; the same registry drives dispatch and the `?` overlay, so a
 * binding added by actions or the palette shows up in the map automatically.
 *
 * Keys are space-separated sequences of tokens: `j`, `g i`, `mod+k`,
 * `escape`, `?`. Printable keys match `event.key` as typed (so `?` and `J`
 * work without spelling out shift). `mod` is cmd on mac, ctrl elsewhere.
 */
export type KeyBinding = {
  /** One sequence or several aliases, e.g. `["j", "arrowdown"]`. */
  keys: string | string[];
  /** Lowercase verb for the map, e.g. `archive`. Omit to hide from the map. */
  label?: string;
  /** Section in the map, e.g. `navigate`, `triage`. */
  group?: string;
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
  private listeners = new Set<() => void>();
  version = 0;

  add(bindings: () => KeyBinding[], exclusive: boolean) {
    const layer: Layer = { exclusive, bindings };
    this.layers = [...this.layers, layer];
    this.emit();
    return () => {
      this.layers = this.layers.filter((l) => l !== layer);
      this.emit();
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

  /** Every registered binding in registration order, for the map. */
  all(): KeyBinding[] {
    return this.layers.flatMap((l) => l.bindings());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

type KeymapContextValue = {
  registry: KeyRegistry;
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

export function tokenFromEvent(event: KeyboardEvent): string | null {
  const { key } = event;
  if (key === "Shift" || key === "Control" || key === "Meta" || key === "Alt") {
    return null;
  }
  const base = key.length === 1 ? key : key.toLowerCase();
  const mods: string[] = [];
  if (event.metaKey || event.ctrlKey) mods.push("mod");
  if (event.altKey) mods.push("alt");
  return [...mods, base === " " ? "space" : base].join("+");
}

const ALIASES: Record<string, string> = { esc: "escape", return: "enter", up: "arrowup", down: "arrowdown" };

function parseSequence(keys: string): string[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((t) => ALIASES[t] ?? t);
}

function sequences(binding: KeyBinding): string[][] {
  return (Array.isArray(binding.keys) ? binding.keys : [binding.keys]).map(parseSequence);
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

export function KeymapProvider({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => new KeyRegistry());
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
        for (const seq of sequences(binding)) {
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

  const value = useMemo(() => ({ registry, pending, mapOpen, setMapOpen }), [registry, pending, mapOpen]);
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

/** Labelled bindings, grouped for the `?` overlay. */
export function useKeyMapEntries() {
  const { registry } = useKeymapContext();
  useSyncExternalStore(
    registry.subscribe,
    () => registry.version,
    () => 0,
  );
  const groups = new Map<string, { keys: string[]; label: string }[]>();
  const seen = new Set<string>();
  for (const b of registry.all()) {
    if (!b.label || seen.has(b.label)) continue;
    seen.add(b.label);
    const group = b.group ?? "general";
    const keys = [b.keys].flat();
    groups.set(group, [...(groups.get(group) ?? []), { keys, label: b.label }]);
  }
  return [...groups.entries()];
}
