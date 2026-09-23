"use client";

import { Kbd, KeyHints } from "@/components/ui/kbd";

import { COMMANDS, effectiveKeys, GROUPS } from "./commands";
import { useKeyMap, useKeys, useOverrides } from "./keymap";

export function KeyMapOverlay() {
  const { open } = useKeyMap();
  if (!open) return null;
  return <KeyMapDialog />;
}

function KeyMapDialog() {
  const { setOpen } = useKeyMap();
  const overrides = useOverrides();
  // Every command with a key, grouped like settings; unbound ones are left out.
  const groups = GROUPS.map((group) => [
    group,
    COMMANDS.filter((c) => c.group === group)
      .map((c) => ({ label: c.label, keys: effectiveKeys(c.id, overrides) }))
      .filter((e) => e.keys.length),
  ] as const).filter(([, entries]) => entries.length);

  useKeys([{ keys: ["escape", ...effectiveKeys("key-map", overrides)], run: () => setOpen(false) }], { exclusive: true });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-4 pt-palette-top"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="keyboard map"
        className="w-full max-w-palette rounded-md border border-border bg-surface-top p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between text-11 text-text-muted">
          <span>keys</span>
          <KeyHints hints={[["escape", "close"]]} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {groups.map(([group, entries]) => (
            <section key={group}>
              <h2 className="mb-2 text-11 text-text-dim">{group}</h2>
              <ul className="flex flex-col gap-1">
                {entries.map((e) => (
                  <li key={e.label} className="flex items-center justify-between gap-4">
                    <span>{e.label}</span>
                    <span className="flex items-center gap-1">
                      {e.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 ? <span className="text-11 text-text-dim">/</span> : null}
                          <Kbd keys={k} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
