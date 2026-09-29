"use client";

import { useEffect, useId, useRef, useState } from "react";

import { suggestRecipients } from "@/app/(mail)/_compose/actions";
import type { Address } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 120;

/** Where the address being typed starts: after the last separator outside quotes and angle brackets. */
function tokenStart(value: string): number {
  let start = 0;
  let quoted = false;
  let angle = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && quoted) i++;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    else if ((ch === "," || ch === ";") && !quoted && angle === 0) start = i + 1;
  }
  return start;
}

/** Addresses already in the field, so they are not suggested twice. */
function typedEmails(value: string): string[] {
  return value.match(/[^\s<>,;"()]+@[^\s<>,;"()]+/g) ?? [];
}

function formatAddress({ name, email }: Address): string {
  if (!name) return email;
  return /[,;"<>()]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>` : `${name} <${email}>`;
}

export function RecipientInput({
  id,
  value,
  onChange,
  className,
  ref,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const request = useRef(0);

  useEffect(() => {
    const seq = ++request.current;
    if (!query) return;
    const timer = setTimeout(() => {
      suggestRecipients(query, typedEmails(value))
        .then((found) => {
          if (seq !== request.current) return;
          setSuggestions(found);
          setActive(0);
        })
        .catch(() => seq === request.current && setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only a new query asks again; `value` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const open = focused && !!query && suggestions.length > 0;

  const change = (next: string, caret: number | null) => {
    onChange(next);
    // Suggest only while typing at the end, where the address being written is.
    const typed = caret === next.length ? next.slice(tokenStart(next)).trim() : "";
    setQuery(typed);
    if (!typed) setSuggestions([]);
  };

  const pick = (address: Address) => {
    const head = value.slice(0, tokenStart(value)).trimEnd();
    onChange(`${head ? `${head} ` : ""}${formatAddress(address)}, `);
    setQuery("");
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      // Closes the list only; compose stays open.
      e.preventDefault();
      setQuery("");
      setSuggestions([]);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-1">
      <input
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => change(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        className={className}
        {...rest}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="suggested recipients"
          className="absolute top-full right-0 left-0 z-10 flex flex-col rounded-md border border-border bg-surface-top py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.email}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the pick lands there.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onPointerMove={() => setActive(i)}
              className={cn(
                "flex h-touch cursor-pointer items-center gap-2 border-l-2 border-transparent pr-3 pl-2 whitespace-nowrap text-text-muted transition-colors duration-80 ease-snap md:h-row",
                i === active && "glow-focus border-accent bg-surface-raised text-text",
              )}
            >
              {s.name ? <span className="shrink-0 truncate">{s.name}</span> : null}
              <span className={cn("min-w-0 truncate", s.name && "text-11 text-text-muted")}>{s.email}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
