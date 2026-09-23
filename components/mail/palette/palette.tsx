"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { BULK_ACTIONS } from "@/app/(mail)/_lib/bulk";
import { paletteSearch, previewSearchAction, type PaletteSearch } from "@/app/(mail)/palette-actions";
import { runThreadAction } from "@/app/(mail)/thread-actions";
import type { ActionPreview } from "@/lib/actions/types";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import type { Bucket } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { describeAction } from "../actions/actions";
import { useUndo } from "../actions/undo";
import { CommandKbd, shortcutOf, useKeys, useOverrides } from "../keys/keymap";
import { RADIO_TOGGLE_EVENT } from "@/components/radio";

import { AccountSquare } from "../account-square";
import { useAccountToggles } from "../account-toggles";
import { useCompose } from "../compose/compose";
import { useMailSelection } from "../selection";
import { Time } from "../time";
import { mailHref, VIEWS, type ViewSlug } from "../views";
import { Highlight, Snippet } from "./highlight";

const SEARCH_DELAY_MS = 120;
// Enough to pick from; bulk actions below cover the rest of the matches.
const VISIBLE_HITS = 10;

const BUCKET_VIEW: Record<Bucket, ViewSlug> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper-trail",
  triage: "triage",
  out: "triage",
};

const PaletteContext = createContext<(() => void) | null>(null);

/** Opens the palette from a button, for touch where there is no cmd+k. */
export function useOpenPalette() {
  const open = useContext(PaletteContext);
  if (!open) throw new Error("useOpenPalette must be used inside <PaletteProvider>");
  return open;
}

/** cmd+k or `/`: one entry point for going somewhere, finding mail, and acting on it. */
export function PaletteProvider({ counts, children }: { counts: Record<ViewSlug, number>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [openPalette] = useState(() => () => setOpen(true));
  useKeys([
    { id: "palette", allowInInput: true, run: () => setOpen((o) => !o) },
    { id: "search", run: openPalette },
  ]);
  return (
    <PaletteContext.Provider value={openPalette}>
      {children}
      {open ? <PaletteDialog counts={counts} onClose={() => setOpen(false)} /> : null}
    </PaletteContext.Provider>
  );
}

type Mode = { kind: "search" } | { kind: "preview"; key: string; label: string; preview: ActionPreview | null };

const CHIPS = ["from:", "account:", "before:", "after:"];

type Section = "threads" | "act on results" | "go to" | "actions" | "accounts" | "app";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Same word-prefix match the highlight marks. */
const matches = (text: string, query: string) =>
  !query || new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(query)}`, "iu").test(text);

function PaletteDialog({ counts, onClose }: { counts: Record<ViewSlug, number>; onClose: () => void }) {
  const { accounts, toggle, appliedKey } = useAccountToggles();
  const sel = useMailSelection();
  const compose = useCompose();
  const router = useRouter();
  const { report, notify } = useUndo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState<{ input: string; result: PaletteSearch } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const query = input.trim();
  // Toggling an account from the palette searches again over the new set.
  const searchKey = `${appliedKey}|${query}`;
  useEffect(() => {
    if (!query) return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      paletteSearch(query)
        .then((result) => {
          if (id === request.current) setSearch({ input: searchKey, result });
        })
        .catch(() => {
          if (id === request.current) setSearch({ input: searchKey, result: { hits: [], total: 0, words: [], counts: {} } });
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, searchKey]);

  const back = () => (mode.kind === "preview" ? setMode({ kind: "search" }) : onClose());
  useKeys(
    [
      { keys: "escape", allowInInput: true, run: back },
      { id: "palette", allowInInput: true, run: onClose },
    ],
    { exclusive: true },
  );

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const startPreview = (key: string, label: string) => {
    setMode({ kind: "preview", key, label, preview: null });
    previewSearchAction(query, key)
      .then((preview) => setMode((m) => (m.kind === "preview" && m.key === key ? { ...m, preview } : m)))
      .catch(() => {
        notify(`${label} preview failed, retry`, "error");
        setMode({ kind: "search" });
      });
  };

  const execute = async (preview: ActionPreview) => {
    if (busy || !preview.count) return;
    setBusy(true);
    try {
      const result = await runThreadAction(
        preview.threads.map((t) => t.id),
        preview.action,
      );
      report(describeAction(preview.action, result.count), result.token);
      onClose();
    } catch {
      notify(`${preview.action.type} failed, retry`, "error");
      setBusy(false);
    }
  };

  // A chip drops its operator in at the caret, spaced from the word before it.
  const insert = (chip: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? at;
    const before = input.slice(0, at);
    const text = (before && !/\s$/.test(before) ? " " : "") + chip;
    setInput(before + text + input.slice(end));
    const caret = at + text.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const current = search && search.input === searchKey ? search.result : null;
  const words = current?.words ?? [];
  const colorOf = new Map(accounts.map((a) => [a.id, a.color]));

  const overrides = useOverrides();
  const views = VIEWS.filter((v) => matches(v.label, query));
  const actions = [
    { key: "compose", label: "compose", keys: shortcutOf("compose", overrides), run: () => compose.open("new", null, sel.account) },
    {
      key: "radio",
      label: "toggle radio",
      keys: shortcutOf("radio", overrides),
      run: () => window.dispatchEvent(new Event(RADIO_TOGGLE_EVENT)),
    },
  ].filter((a) => matches(a.label, query));
  const accountRows = accounts.length > 1 ? accounts.filter((a) => matches(`${a.label} ${a.email}`, query)) : [];
  const app = matches("settings", query);
  const hits = current?.hits.slice(0, VISIBLE_HITS) ?? [];

  // The first row is focused on open and after every keystroke or new result.
  const values = [
    ...hits.map((h) => `thread:${h.id}`),
    ...(current?.total ? BULK_ACTIONS.filter((a) => current.counts[a.key]).map((a) => `act:${a.key}`) : []),
    ...views.map((v) => `view:${v.slug}`),
    ...actions.map((a) => `action:${a.key}`),
    ...accountRows.map((a) => `account:${a.id}`),
    ...(app ? ["app:settings"] : []),
  ];
  const listKey = `${query}|${current ? "results" : ""}`;
  const [picked, setPicked] = useState<{ key: string; value: string } | null>(null);
  const value = picked?.key === listKey && values.includes(picked.value) ? picked.value : (values[0] ?? "");

  const heading = (name: Section, count: number) => <SectionHeading name={name} count={count} />;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-2 pt-2 pb-2 md:px-4 md:pt-palette-top md:pb-palette-top" onClick={onClose}>
      <Command
        label="palette"
        shouldFilter={false}
        loop
        value={value}
        onValueChange={(v) => setPicked({ key: listKey, value: v })}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-palette flex-col overflow-hidden rounded-md border border-border bg-surface-top"
      >
        {mode.kind === "search" ? (
          <>
            <div className="flex h-touch shrink-0 items-center gap-2 border-b border-border px-3">
              <span aria-hidden className="text-accent">
                &gt;
              </span>
              <Command.Input
                ref={inputRef}
                autoFocus
                value={input}
                onValueChange={setInput}
                placeholder="search mail, go to, act on results"
                className="h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-dim"
              />
              <Kbd keys="escape" />
            </div>
            <Command.List className="min-h-0 overflow-y-auto pb-1">
              {query && !current ? <Line>searching</Line> : null}
              {query && current && !values.length ? <Line>no matches</Line> : null}

              {hits.length && current ? (
                <Command.Group heading={heading("threads", current.total)}>
                  {hits.map((hit) => (
                    <Item
                      key={hit.id}
                      value={`thread:${hit.id}`}
                      onSelect={() => go(mailHref(BUCKET_VIEW[hit.bucket], { threadId: hit.id }))}
                    >
                      <span className="flex shrink-0 gap-1">
                        {hit.accountIds.map((id) => (
                          <AccountSquare key={id} color={colorOf.get(id)} />
                        ))}
                      </span>
                      <span className="w-sender shrink-0 truncate text-text-muted">
                        <Highlight text={hit.sender} words={words} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <Highlight text={hit.subject} words={words} />
                        {hit.snippet ? (
                          <span className="text-text-muted">
                            {" "}
                            <Snippet text={hit.snippet} />
                          </span>
                        ) : null}
                      </span>
                      {hit.archived ? <span className="shrink-0 text-11 text-text-dim">archived</span> : null}
                      <Time iso={hit.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
                    </Item>
                  ))}
                </Command.Group>
              ) : null}

              {current?.total ? (
                <Command.Group heading={heading("act on results", BULK_ACTIONS.length)}>
                  {BULK_ACTIONS.map((a) => {
                    const n = current.counts[a.key] ?? 0;
                    return (
                      <Item key={a.key} value={`act:${a.key}`} disabled={!n} onSelect={() => startPreview(a.key, a.label)}>
                        <span className="flex-1">{a.label}</span>
                        {n > 1 ? (
                          <span className="text-11 text-info">{n} threads</span>
                        ) : (
                          <span className="text-11 text-text-dim">{n ? "1 thread" : "nothing to change"}</span>
                        )}
                      </Item>
                    );
                  })}
                </Command.Group>
              ) : null}

              {views.length ? (
                <Command.Group heading={heading("go to", views.length)}>
                  {views.map((v) => {
                    const dim = v.group === "bottom";
                    return (
                      <Item key={v.slug} value={`view:${v.slug}`} onSelect={() => go(mailHref(v.slug))}>
                        <span className={cn("flex-1 truncate", dim && "text-text-dim")}>
                          <Highlight text={v.label} words={query ? [query] : []} />
                        </span>
                        {!dim && counts[v.slug] ? <span className="text-11 text-text-muted">{counts[v.slug]}</span> : null}
                        <CommandKbd id={v.command} />
                      </Item>
                    );
                  })}
                </Command.Group>
              ) : null}

              {actions.length ? (
                <Command.Group heading={heading("actions", actions.length)}>
                  {actions.map((a) => (
                    <Item
                      key={a.key}
                      value={`action:${a.key}`}
                      onSelect={() => {
                        onClose();
                        a.run();
                      }}
                    >
                      <span className="flex-1 truncate">
                        <Highlight text={a.label} words={query ? [query] : []} />
                      </span>
                      {a.keys ? <Kbd keys={a.keys} /> : null}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}

              {accountRows.length ? (
                <Command.Group heading={heading("accounts", accountRows.length)}>
                  {accountRows.map((a) => (
                    // Toggles like the header; the palette stays open.
                    <Item key={a.id} value={`account:${a.id}`} onSelect={() => toggle(a.id)} aria-pressed={a.on}>
                      <AccountSquare color={a.color} off={!a.on} />
                      <span className={cn("shrink-0", !a.on && "text-text-dim")}>
                        <Highlight text={a.label} words={query ? [query] : []} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-text-dim">{a.email}</span>
                    </Item>
                  ))}
                </Command.Group>
              ) : null}

              {app ? (
                <Command.Group heading={heading("app", 1)}>
                  <Item value="app:settings" onSelect={() => go("/settings")}>
                    <span className="flex-1">
                      <Highlight text="settings" words={query ? [query] : []} />
                    </span>
                    <CommandKbd id="go.settings" />
                  </Item>
                </Command.Group>
              ) : null}
            </Command.List>
            <div className="flex min-h-row shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-1 md:h-row md:flex-nowrap md:py-0">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  // Keep the caret where it is so the chip lands there.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(chip)}
                  className="h-6 rounded-sm border border-border px-2 text-11 text-text-muted transition-colors duration-80 ease-snap hover:text-text"
                >
                  {chip}
                </button>
              ))}
              <KeyHints className="ml-auto text-11 text-text-muted" hints={[["arrowup arrowdown", "move"], ["enter", "open"]]} />
            </div>
          </>
        ) : (
          <PreviewPane mode={mode} busy={busy} onConfirm={execute} onBack={() => setMode({ kind: "search" })} />
        )}
      </Command>
    </div>
  );
}

function SectionHeading({ name, count }: { name: string; count?: number }) {
  return (
    <span className="flex items-center gap-2 px-3 pt-3 pb-1 text-11">
      <span className="text-text-muted uppercase">{name}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {count !== undefined ? <span className="text-text-dim">{count}</span> : null}
    </span>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <Command.Group heading={<SectionHeading name={heading} />}>{children}</Command.Group>;
}

function PreviewPane({
  mode,
  busy,
  onConfirm,
  onBack,
}: {
  mode: Extract<Mode, { kind: "preview" }>;
  busy: boolean;
  onConfirm: (preview: ActionPreview) => void;
  onBack: () => void;
}) {
  const { preview } = mode;
  // cmdk needs a focused element inside the root to drive arrows and Enter.
  const focusRef = useRef<HTMLInputElement>(null);
  useEffect(() => focusRef.current?.focus(), []);

  return (
    <>
      <div className="flex h-touch shrink-0 items-center gap-2 border-b border-border px-3">
        <span>{mode.label}</span>
        <span className="text-info">
          {preview ? `${preview.count} ${preview.count === 1 ? "thread" : "threads"}` : "counting"}
        </span>
        {/* Hidden input keeps keyboard focus in the palette without offering a text field. */}
        <Command.Input ref={focusRef} value="" readOnly aria-label="confirm" className="sr-only" />
      </div>
      <Command.List className="min-h-0 overflow-y-auto py-1">
        {preview?.count ? (
          <>
            <Group heading="confirm">
              <Item value="confirm" disabled={busy} onSelect={() => onConfirm(preview)}>
                <span className="flex-1">
                  {mode.label} {preview.count} {preview.count === 1 ? "thread" : "threads"}
                </span>
                <Kbd keys="enter" />
              </Item>
            </Group>
            <Group heading="affected">
              {preview.threads.slice(0, 100).map((t) => (
                <div key={t.id} className="flex h-touch items-center gap-2 px-3 text-text-muted md:h-row">
                  <span className="w-sender shrink-0 truncate">{t.sender}</span>
                  <span className="min-w-0 flex-1 truncate text-text">{t.subject}</span>
                  <span className="shrink-0 text-11">{t.account}</span>
                </div>
              ))}
              {preview.count > 100 ? <Line>and {preview.count - 100} more</Line> : null}
            </Group>
          </>
        ) : preview ? (
          <Line>nothing to change</Line>
        ) : null}
      </Command.List>
      <div className="flex h-touch shrink-0 items-center border-t border-border px-3 text-11 text-text-dim md:h-status">
        <button type="button" onClick={onBack} className="h-touch text-13 text-text-muted md:hidden">
          back
        </button>
        <KeyHints className="ml-auto" hints={[["enter", "run"], ["escape", "back"]]} />
      </div>
    </>
  );
}

function Item({
  className,
  ...props
}: React.ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      className={cn(
        "flex h-touch cursor-default items-center gap-2 border-l-2 border-transparent pr-3 pl-2 transition-colors duration-80 ease-snap md:h-row",
        "data-[selected=true]:glow-focus data-[selected=true]:border-accent data-[selected=true]:bg-surface-raised",
        "data-[disabled=true]:text-text-dim",
        className,
      )}
      {...props}
    />
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-text-muted">{children}</p>;
}
