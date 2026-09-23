"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  boundKeys,
  COMMANDS,
  conflictsFor,
  findCommand,
  GROUPS,
  isReserved,
  normalizeKeys,
  validOverrides,
  type Command,
  type CommandId,
  type Overrides,
} from "@/components/mail/keys/commands";
import { tokenFromEvent } from "@/components/mail/keys/keymap";
import { Button } from "@/components/ui/button";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { resetKeybindings, saveKeybindings } from "./actions";

// Same wait as the mail keymap gives a sequence to finish.
const SEQUENCE_TIMEOUT_MS = 1000;

type Recording = { id: CommandId; steps: string[] };
type Notice =
  | { kind: "conflict"; id: CommandId; keys: string; holder: CommandId }
  | { kind: "message"; id: CommandId; text: string };

const label = (id: CommandId) => findCommand(id)?.label ?? id;

/**
 * Every command with its keys. A row records a new key or two-key sequence;
 * esc cancels, backspace unbinds. A key already taken in the same scope
 * offers a swap, reserved keys are refused.
 */
export function KeyboardSection({ initial }: { initial: Overrides }) {
  const [overrides, setOverrides] = useState(initial);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, startSaving] = useTransition();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const save = (changes: Record<string, string[] | null>) =>
    startSaving(async () => {
      const result = await saveKeybindings(changes);
      if (result.ok) {
        setOverrides(result.overrides);
        setNotice(null);
      } else {
        const id = Object.keys(changes)[0] as CommandId;
        setNotice({ kind: "message", id, text: result.message });
      }
    });

  const finish = (id: CommandId, steps: string[]) => {
    setRecording(null);
    rowRefs.current.get(id)?.focus();
    const keys = normalizeKeys(steps.join(" "));
    if (!keys) return setNotice({ kind: "message", id, text: "can't bind that key" });
    if (isReserved(keys)) return setNotice({ kind: "message", id, text: `${keys} is reserved` });
    if (boundKeys(id, overrides).length === 1 && boundKeys(id, overrides)[0] === keys) return setNotice(null);
    const others = { ...overrides, [id]: [] };
    const holders = conflictsFor(id, keys, others);
    if (holders.length === 1) return setNotice({ kind: "conflict", id, keys, holder: holders[0] });
    if (holders.length > 1)
      return setNotice({ kind: "message", id, text: `${keys} clashes with ${holders.map(label).join(", ")}` });
    save({ [id]: [keys] });
  };

  // While recording, every key belongs to the recorder: nothing reaches esc-to-leave or the menu arrows.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(() => {
    if (!recording) return;
    const { id, steps } = recording;
    const timer = steps.length ? setTimeout(() => finishRef.current(id, steps), SEQUENCE_TIMEOUT_MS) : null;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (plain && e.key === "Escape") {
        setRecording(null);
        rowRefs.current.get(id)?.focus();
        return;
      }
      if (plain && e.key === "Backspace" && !steps.length) {
        setRecording(null);
        rowRefs.current.get(id)?.focus();
        save({ [id]: [] });
        return;
      }
      const token = tokenFromEvent(e);
      if (!token) return;
      const next = [...steps, token];
      // A reserved key is refused at once rather than waiting for a second one.
      if (next.length === 2 || isReserved(token)) finishRef.current(id, next);
      else setRecording({ id, steps: next });
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (timer) clearTimeout(timer);
    };
  }, [recording]);

  // A pending conflict answers to esc as cancel, before esc can leave settings.
  useEffect(() => {
    if (notice?.kind !== "conflict") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setNotice(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [notice]);

  const swap = (n: Extract<Notice, { kind: "conflict" }>) => {
    const next = { ...overrides, [n.id]: [n.keys], [n.holder]: boundKeys(n.id, overrides) };
    if (!validOverrides(next)) return setNotice({ kind: "message", id: n.id, text: "can't swap, pick another key" });
    save({ [n.id]: [n.keys], [n.holder]: boundKeys(n.id, overrides) });
    rowRefs.current.get(n.id)?.focus();
  };

  // Up and down walk the rows, like the menu walks sections.
  const onListKey = (e: React.KeyboardEvent) => {
    if (recording || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const rows = [...rowRefs.current.values()].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const changed = Object.keys(overrides).length > 0;

  return (
    <section className="flex flex-col gap-4" onKeyDown={onListKey}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-15 font-medium">keyboard</h1>
        <Button
          variant="ghost"
          size="sm"
          disabled={!changed || saving}
          onClick={() =>
            startSaving(async () => {
              const result = await resetKeybindings();
              if (result.ok) setOverrides(result.overrides);
              setNotice(null);
            })
          }
        >
          reset all
        </Button>
      </div>

      {GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-1">
          <h2 className="text-11 text-text-dim">{group}</h2>
          <ul className="flex flex-col">
            {COMMANDS.filter((c) => c.group === group).map((c) => (
              <Row
                key={c.id}
                command={c}
                overrides={overrides}
                recording={recording?.id === c.id ? recording.steps : null}
                notice={notice?.id === c.id ? notice : null}
                disabled={saving}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(c.id, el);
                  else rowRefs.current.delete(c.id);
                }}
                onRecord={() => {
                  setNotice(null);
                  setRecording({ id: c.id, steps: [] });
                }}
                onReset={() => save({ [c.id]: null })}
                onSwap={swap}
                onCancel={() => setNotice(null)}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function Keys({ keys }: { keys: readonly string[] }) {
  if (!keys.length) return <span className="text-11 text-text-dim">none</span>;
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 ? <span className="text-11 text-text-dim">/</span> : null}
          <Kbd keys={k} />
        </span>
      ))}
    </span>
  );
}

function Row({
  command,
  overrides,
  recording,
  notice,
  disabled,
  rowRef,
  onRecord,
  onReset,
  onSwap,
  onCancel,
}: {
  command: Command;
  overrides: Overrides;
  recording: string[] | null;
  notice: Notice | null;
  disabled: boolean;
  rowRef: (el: HTMLButtonElement | null) => void;
  onRecord: () => void;
  onReset: () => void;
  onSwap: (n: Extract<Notice, { kind: "conflict" }>) => void;
  onCancel: () => void;
}) {
  const id = command.id as CommandId;
  const fixed = command.fixed ?? [];
  const bound = boundKeys(id, overrides);
  const changed = overrides[id] !== undefined;
  // Commands made only of fixed keys (esc, arrows, send) are shown, not edited.
  const editable = command.keys.length > 0 || !fixed.length;

  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-text">{command.label}</span>
      {changed ? (
        <span className="hidden items-center gap-2 text-11 text-text-dim md:flex">
          default
          <Keys keys={command.keys} />
        </span>
      ) : null}
      {recording ? (
        <span className="flex items-center gap-2">
          {recording.length ? <Kbd keys={recording.join(" ")} /> : null}
          <span className="text-11 text-accent">recording</span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          {bound.length || !fixed.length ? <Keys keys={bound} /> : null}
          {fixed.length && bound.length ? <span className="text-11 text-text-dim">/</span> : null}
          {fixed.length ? <Keys keys={fixed} /> : null}
          {fixed.length ? <span className="ml-1 text-11 text-text-dim">fixed</span> : null}
        </span>
      )}
    </>
  );

  const rowClass =
    "flex h-touch min-w-0 flex-1 items-center gap-4 rounded-sm border-l-2 border-transparent px-2 text-left outline-none transition-colors duration-80 ease-snap md:h-row";

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1">
        {editable ? (
          <button
            ref={rowRef}
            type="button"
            disabled={disabled && !recording}
            aria-label={`${command.label}, press to record a new key`}
            onClick={onRecord}
            className={cn(
              rowClass,
              "hover:bg-surface-raised focus-visible:glow-focus focus-visible:border-accent focus-visible:bg-surface-raised",
              recording && "glow-focus border-accent bg-surface-raised",
            )}
          >
            {body}
          </button>
        ) : (
          <div className={rowClass}>{body}</div>
        )}
        <Button
          variant="ghost"
          size="sm"
          tabIndex={changed ? 0 : -1}
          aria-hidden={!changed}
          disabled={disabled}
          onClick={onReset}
          className={cn(!changed && "invisible")}
        >
          reset
        </Button>
      </div>

      {recording ? (
        <div className="flex h-6 items-center pl-3 text-12 text-text-muted">
          <KeyHints hints={[["escape", "cancel"], ["backspace", "clear"]]} />
        </div>
      ) : notice?.kind === "conflict" ? (
        <div className="flex min-h-6 flex-wrap items-center gap-1 pl-3 text-12 text-warning">
          <span className="mr-2">
            {notice.keys} is taken by {label(notice.holder)}
          </span>
          <Button size="sm" disabled={disabled} onClick={() => onSwap(notice)}>
            swap
          </Button>
          <Button variant="ghost" size="sm" shortcut="escape" onClick={onCancel}>
            cancel
          </Button>
        </div>
      ) : notice ? (
        <p className="flex h-6 items-center pl-3 text-12 text-warning">{notice.text}</p>
      ) : null}
    </li>
  );
}
