"use client";

import { Command, useCommandState } from "cmdk";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { BULK_KEEP_OUT, BULK_SNOOZE, bulkActions } from "@/app/(mail)/_lib/bulk";
import {
  paletteSearch,
  previewSearchAction,
  previewSearchKeepOut,
  previewSearchSnooze,
  type PaletteSearch,
} from "@/app/(mail)/palette-actions";
import { logout } from "@/app/(mail)/logout-action";
import { runBulkKeepOut, runThreadAction } from "@/app/(mail)/thread-actions";
import type { ActionPreview, KeepOutPreview } from "@/lib/actions/types";
import { Kbd, KeyHints } from "@/components/ui/kbd";
import type { Bucket } from "@/lib/db/schema";
import { parseQuery } from "@/lib/search/query";
import { cn } from "@/lib/utils";

import { describeAction } from "../actions/actions";
import { SnoozePicker } from "../actions/snooze-picker";
import { useUndo } from "../actions/undo";
import { CommandKbd, shortcutOf, useKeys, useOverrides } from "../keys/keymap";
import { RADIO_TOGGLE_EVENT } from "@/components/radio";

import { AccountSquare } from "../account-square";
import { useAccountToggles } from "../account-toggles";
import { useCompose } from "../compose/compose";
import { useMailSelection } from "../selection";
import { fullTime, Time } from "../time";
import { useProjects } from "../projects-context";
import { mailHref, projectView, type View, type ViewSlug } from "../views";
import { useViews, useWorkOn } from "../work-context";
import { Highlight, Snippet } from "./highlight";

const SEARCH_DELAY_MS = 120;

const BUCKET_VIEW: Record<Bucket, ViewSlug> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper-trail",
  receipts: "receipts",
  triage: "triage",
  out: "triage",
};

const PaletteContext = createContext<((query?: string) => void) | null>(null);

/** Opens the palette from a button, for touch where there is no cmd+k; with a query, already searching it. */
export function useOpenPalette() {
  const open = useContext(PaletteContext);
  if (!open) throw new Error("useOpenPalette must be used inside <PaletteProvider>");
  return open;
}

/** The same, or null outside the palette's provider (the card works there too, without "their mail"). */
export function usePaletteOpener() {
  return useContext(PaletteContext);
}

/** cmd+k or `/`: one entry point for going somewhere, finding mail, and acting on it. */
export function PaletteProvider({ counts, children }: { counts: Record<ViewSlug, number>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState("");
  const [openPalette] = useState(() => (query?: string) => {
    setInitial(query ?? "");
    setOpen(true);
  });
  useKeys([
    { id: "palette", allowInInput: true, run: () => (open ? setOpen(false) : openPalette()) },
    { id: "search", run: () => openPalette() },
  ]);
  return (
    <PaletteContext.Provider value={openPalette}>
      {children}
      {open ? <PaletteDialog counts={counts} initial={initial} onClose={() => setOpen(false)} /> : null}
    </PaletteContext.Provider>
  );
}

type Preview = ActionPreview | KeepOutPreview;

type Mode =
  | { kind: "search" }
  | { kind: "snooze" }
  | { kind: "preview"; key: string; label: string; detail?: string; preview: Preview | null };

const isKeepOut = (p: Preview): p is KeepOutPreview => "senders" in p;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const unitOf = (p: Preview) => (isKeepOut(p) ? "sender" : "thread");

/** Every bulk row the results pane lists: thread actions (project moves among them), snooze, then keep out per sender. */
const bulkRows = (projects: { id: string; name: string }[], workOn: boolean) => [
  ...bulkActions(projects)
    .filter((a) => workOn || a.key !== "work")
    .map((a) => ({ key: a.key, label: a.label, unit: "thread" })),
  { ...BULK_SNOOZE, unit: "thread" },
  ...BULK_KEEP_OUT.map((a) => ({ key: a.key, label: a.label, unit: "sender" })),
];

const CHIPS = ["from:", "account:", "before:", "after:", "bucket:"];

type Section = "go to" | "actions" | "accounts" | "app";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Same word-prefix match the highlight marks. */
const matches = (text: string, query: string) =>
  !query || new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(query)}`, "iu").test(text);

function PaletteDialog({ counts, initial, onClose }: { counts: Record<ViewSlug, number>; initial: string; onClose: () => void }) {
  const { accounts, toggle, appliedKey } = useAccountToggles();
  const sel = useMailSelection();
  const compose = useCompose();
  const router = useRouter();
  const { report, notify } = useUndo();
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const [pane, setPane] = useState<{ key: string; name: "threads" | "actions" } | null>(null);
  const [input, setInput] = useState(initial);
  const [search, setSearch] = useState<
    { input: string; result: PaletteSearch; error?: never } | { input: string; result: null; error: string } | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [busy, setBusy] = useState(false);

  const query = input.trim();
  // Toggling an account from the palette searches again over the new set.
  const searchKey = `${appliedKey}|${query}|${attempt}`;
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      paletteSearch(query)
        .then((result) => {
          if (cancelled) return;
          setSearch({ input: searchKey, result });
          if (parseQuery(query).words.length) {
            void paletteSearch(query, { semantic: true }).then((hybrid) => {
              if (!cancelled) setSearch({ input: searchKey, result: hybrid });
            }).catch(() => {});
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearch({
              input: searchKey,
              result: null,
              error: navigator.onLine ? "search failed, retry" : "offline, reconnect to search",
            });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [query, searchKey]);

  const back = () => (mode.kind === "search" ? onClose() : setMode({ kind: "search" }));
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

  const startPreview = (key: string, label: string, load: () => Promise<Preview> = () => previewSearchAction(query, key), detail?: string) => {
    setMode({ kind: "preview", key, label, detail, preview: null });
    load()
      .then((preview) => setMode((m) => (m.kind === "preview" && m.key === key ? { ...m, preview } : m)))
      .catch(() => {
        notify(`${label} preview failed, retry`, "error");
        setMode({ kind: "search" });
      });
  };

  const pickBulk = (key: string, label: string) => {
    if (key === BULK_SNOOZE.key) setMode({ kind: "snooze" });
    else if (BULK_KEEP_OUT.some((a) => a.key === key)) startPreview(key, label, () => previewSearchKeepOut(query, key));
    else startPreview(key, label);
  };

  const execute = async (preview: Preview) => {
    if (busy || !preview.count) return;
    setBusy(true);
    try {
      if (isKeepOut(preview)) {
        const result = await runBulkKeepOut(preview.threadIds, preview.spam);
        report(describeAction({ type: "keepOut", spam: preview.spam }, result.count, false, result.senders), result.token);
      } else {
        const result = await runThreadAction(
          preview.threads.map((t) => t.id),
          preview.action,
        );
        report(describeAction(preview.action, result.count), result.token);
      }
      onClose();
    } catch {
      notify(`${isKeepOut(preview) ? "keep out" : preview.action.type} failed, retry`, "error");
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
  const searchError = search?.input === searchKey ? search.error : undefined;
  const words = current?.words ?? [];
  const colorOf = new Map(accounts.map((a) => [a.id, a.color]));

  const overrides = useOverrides();
  const projects = useProjects();
  const workOn = useWorkOn();
  const fixedViews = useViews();
  const BULK_ROWS = bulkRows(projects, workOn);
  const views = [...fixedViews, ...projects.map(projectView)].filter((v: View) => matches(v.label, query));
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
  const app = {
    settings: matches("settings", query),
    logout: matches("log out", query),
  };
  const appCount = Number(app.settings) + Number(app.logout);
  const hits = current?.hits ?? [];

  // The first row is focused on open and after every keystroke or new result.
  const threadValues = [
    ...(searchError ? ["search:retry"] : []),
    ...hits.map((h) => `thread:${h.id}`),
  ];
  const actionValues = [
    ...(current?.total ? BULK_ROWS.filter((a) => current.counts[a.key]).map((a) => `act:${a.key}`) : []),
    ...views.map((v) => `view:${v.slug}`),
    ...actions.map((a) => `action:${a.key}`),
    ...accountRows.map((a) => `account:${a.id}`),
    ...(app.settings ? ["app:settings"] : []),
    ...(app.logout ? ["app:logout"] : []),
  ];
  const listKey = `${searchKey}|${searchError ? "error" : current ? "results" : ""}`;
  const [picked, setPicked] = useState<{ key: string; value: string } | null>(null);
  const activePane = query ? (pane?.key === searchKey ? pane.name : "threads") : "actions";
  const activeValues = activePane === "threads" ? threadValues : actionValues;
  const value = mode.kind === "preview"
    ? (mode.preview?.count && !busy ? "confirm" : "")
    : picked?.key === listKey && activeValues.includes(picked.value) ? picked.value : (activeValues[0] ?? "");
  const selectPane = (name: "threads" | "actions") => {
    setPane({ key: searchKey, name });
    setPicked(null);
    inputRef.current?.focus({ preventScroll: true });
  };

  const heading = (name: Section, count: number) => <SectionHeading name={name} count={count} />;

  // The picker stands in for the palette; its keys take over until it closes.
  if (mode.kind === "snooze") {
    return (
      <SnoozePicker
        onPick={(snooze) =>
          startPreview(
            BULK_SNOOZE.key,
            BULK_SNOOZE.label,
            () => previewSearchSnooze(query, snooze),
            `until ${fullTime(snooze.until)}${snooze.needsReply ? ", needs reply" : ""}`,
          )
        }
        onUnsnooze={() => {}}
        onClose={() => setMode({ kind: "search" })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-2 pt-2 pb-2 md:px-4 md:pt-palette-top md:pb-palette-top" onClick={onClose}>
      <Command
        label="palette"
        shouldFilter={false}
        loop
        value={value}
        onValueChange={(v) => {
          if (activeValues.includes(v)) setPicked({ key: listKey, value: v });
        }}
        onKeyDownCapture={(e) => {
          if (mode.kind !== "search" || e.nativeEvent.isComposing || e.target !== inputRef.current) return;
          if (query && e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            selectPane(activePane === "threads" ? "actions" : "threads");
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || (e.ctrlKey && ["n", "j", "p", "k"].includes(e.key))) {
            e.preventDefault();
            e.stopPropagation();
            if (!activeValues.length) return;
            const delta = ["ArrowDown", "n", "j"].includes(e.key) ? 1 : -1;
            const index = activeValues.indexOf(value);
            const next = e.key === "Home" ? activeValues[0]
              : e.key === "End" ? activeValues.at(-1)
              : activeValues[(index + delta + activeValues.length) % activeValues.length];
            if (next) setPicked({ key: listKey, value: next });
          }
        }}
        data-searching={Boolean(query) && mode.kind === "search"}
        onClick={(e) => e.stopPropagation()}
        className={cn("palette-shell flex max-h-full w-full flex-col overflow-hidden rounded-md border border-border bg-surface-top", query && mode.kind === "search" ? "max-w-palette-wide" : "max-w-palette")}
      >
        <SelectionSync />
        {mode.kind === "search" ? (
          <>
            <div className="palette-search-header flex h-touch shrink-0 items-center gap-2 border-b border-border px-3">
              <span aria-hidden className="text-accent">
                &gt;
              </span>
              <Command.Input
                ref={inputRef}
                autoFocus
                value={input}
                onValueChange={setInput}
                aria-label="search mail and commands"
                aria-describedby={helpId}
                placeholder="search mail, go to, act on results"
                className="h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-dim"
              />
              <Kbd keys="escape" />
            </div>
            <p id={helpId} className="sr-only">
              {query ? "Up and down move within a list. Tab or Shift Tab switches lists. Enter opens a thread or previews a bulk action." : "Up and down move. Enter selects a command."}
            </p>
            <Command.List className={cn(
              "palette-lists flex min-h-0 flex-col overflow-hidden [&>[cmdk-list-sizer]]:min-h-0 [&>[cmdk-list-sizer]]:overflow-hidden",
              query
                ? "[&>[cmdk-list-sizer]]:grid [&>[cmdk-list-sizer]]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[cmdk-list-sizer]]:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] md:[&>[cmdk-list-sizer]]:grid-rows-1"
                : "[&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col",
            )} data-split={Boolean(query)}>
              {query ? (
              <div className="palette-pane palette-pane-threads flex min-h-0 min-w-0 flex-col" data-active={activePane === "threads"}
                onPointerDownCapture={() => selectPane("threads")} onPointerMove={() => {
                  if (activePane !== "threads") setPane({ key: searchKey, name: "threads" });
                }}>
                <div className="palette-pane-heading shrink-0">
                  <SectionHeading name="thread search" count={current?.total} />
                  <span role="status" className="block px-3 pb-2 text-11 text-text-muted">
                    {current ? `${current.total} matched${current.total > hits.length ? ` · showing ${hits.length}` : ""}` : searchError ? "search unavailable" : "searching"}
                  </span>
                </div>
                <div className="palette-pane-scroll min-h-0 overflow-y-auto overscroll-contain pb-1">
              {query && searchError ? (
                <>
                  <div role="alert" className="px-3 py-2 text-danger">{searchError}</div>
                  <Item value="search:retry" onSelect={() => setAttempt((n) => n + 1)}>
                    retry search
                  </Item>
                </>
              ) : null}
              {query && current && !hits.length ? <Line>no matching threads, try another search</Line> : null}

              {hits.length && current ? (
                <Command.Group heading={<span className="sr-only">thread search</span>}>
                  {hits.map((hit) => (
                    <Item
                      key={hit.id}
                      className="palette-thread-row"
                      value={`thread:${hit.id}`}
                      onSelect={() => go(mailHref(BUCKET_VIEW[hit.bucket], { threadId: hit.id }))}
                    >
                      <span className="flex w-full min-w-0 items-baseline gap-2">
                        <span className="flex shrink-0 gap-1">
                          {hit.accountIds.map((id) => (
                            <AccountSquare key={id} color={colorOf.get(id)} />
                          ))}
                        </span>
                        <span className="min-w-0 flex-1 break-words font-medium" title={hit.sender}>
                          {hit.related ? hit.sender : <Highlight text={hit.sender} words={words} />}
                        </span>
                        {hit.related ? <span className="shrink-0 text-11 text-text-muted">related</span> : null}
                        {hit.archived ? <span className="shrink-0 text-11 text-text-dim">archived</span> : null}
                        <Time iso={hit.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
                      </span>
                      <span className="line-clamp-2 w-full break-words" title={hit.subject}>
                        {hit.related ? hit.subject : <Highlight text={hit.subject} words={words} />}
                      </span>
                      {hit.snippet ? (
                        <span className="flex w-full min-w-0 items-baseline gap-2 text-12 text-text-muted">
                          <span className="shrink-0 text-11">message</span>
                          <span className="line-clamp-2 min-w-0 break-words">{hit.related ? hit.snippet : <Snippet text={hit.snippet} />}</span>
                        </span>
                      ) : null}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}

                </div>
              </div>
              ) : null}
              <div className="palette-pane palette-pane-actions flex min-h-0 min-w-0 flex-col" data-active={activePane === "actions"}
                onPointerDownCapture={() => selectPane("actions")} onPointerMove={() => {
                  if (activePane !== "actions") setPane({ key: searchKey, name: "actions" });
                }}>
                {query ? <div className="palette-pane-heading shrink-0"><SectionHeading name="act on results" />
                  <p className="px-3 pb-2 text-11 text-text-muted">bulk actions preview before running</p>
                </div> : null}
                <div className="palette-pane-scroll min-h-0 overflow-y-auto overscroll-contain pb-1">
                {query && !current ? <Line>{searchError ? "retry search to preview actions" : "waiting for results"}</Line> : null}
                {query && current && !current.total ? <Line>no threads to act on</Line> : null}
              {current?.total ? (
                <Command.Group heading={<span className="sr-only">bulk previews</span>}>
                  {BULK_ROWS.map((a) => {
                    const n = current.counts[a.key] ?? 0;
                    return (
                      <Item key={a.key} value={`act:${a.key}`} disabled={!n} onSelect={() => pickBulk(a.key, a.label)}>
                        <span className="flex-1">{a.label}</span>
                        {n > 1 ? (
                          <span className="text-11 text-info">{plural(n, a.unit)}</span>
                        ) : (
                          <span className="text-11 text-text-dim">{n ? plural(1, a.unit) : "nothing to change"}</span>
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
                        {v.command ? <CommandKbd id={v.command} /> : null}
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

              {appCount ? (
                <Command.Group heading={heading("app", appCount)}>
                  {app.settings ? (
                    <Item value="app:settings" onSelect={() => go("/settings")}>
                      <span className="flex-1">
                        <Highlight text="settings" words={query ? [query] : []} />
                      </span>
                      <CommandKbd id="go.settings" />
                    </Item>
                  ) : null}
                  {app.logout ? (
                    <Item
                      value="app:logout"
                      onSelect={() => {
                        onClose();
                        void logout();
                      }}
                    >
                      <span className="flex-1">
                        <Highlight text="log out" words={query ? [query] : []} />
                      </span>
                    </Item>
                  ) : null}
                </Command.Group>
              ) : null}
                </div>
              </div>
            </Command.List>
            <div className="palette-footer flex min-h-row shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-1 md:h-row md:flex-nowrap md:py-0">
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
              <KeyHints className="ml-auto text-11 text-text-muted" hints={query ? [["arrowup arrowdown", "move"], ["tab", "switch list"], ["enter", activePane === "threads" ? "open" : "select"]] : [["arrowup arrowdown", "move"], ["enter", "open"]]} />
            </div>
          </>
        ) : (
          <PreviewPane mode={mode} busy={busy} onConfirm={execute} onBack={() => setMode({ kind: "search" })} />
        )}
      </Command>
    </div>
  );
}

/** cmdk does not refresh its active descendant or scroll on externally controlled selection. */
function SelectionSync() {
  const marker = useRef<HTMLSpanElement>(null);
  const value = useCommandState((state) => state.value);
  const selectedId = useCommandState((state) => state.selectedItemId);
  useLayoutEffect(() => {
    const root = marker.current?.closest("[cmdk-root]");
    const selected = root?.querySelector<HTMLElement>("[cmdk-item][aria-selected=true]");
    for (const element of root?.querySelectorAll("[cmdk-input], [cmdk-list]") ?? []) {
      if (selected) element.setAttribute("aria-activedescendant", selected.id);
      else element.removeAttribute("aria-activedescendant");
    }
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value, selectedId]);
  return <span ref={marker} hidden />;
}

function SectionHeading({ name, count }: { name: string; count?: number }) {
  return (
    <span className="palette-section-heading flex items-center gap-2 px-3 pt-3 pb-1 text-11">
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
  onConfirm: (preview: Preview) => void;
  onBack: () => void;
}) {
  const { preview } = mode;
  // cmdk needs a focused element inside the root to drive arrows and Enter.
  const focusRef = useRef<HTMLInputElement>(null);
  useEffect(() => focusRef.current?.focus(), []);

  return (
    <>
      <div className="palette-search-header flex h-touch shrink-0 items-center gap-2 border-b border-border px-3">
        <span>{mode.label}</span>
        <span className="text-info">
          {preview ? plural(preview.count, unitOf(preview)) : "counting"}
        </span>
        {mode.detail ? <span className="min-w-0 truncate text-text-muted">{mode.detail}</span> : null}
        {/* Hidden input keeps keyboard focus in the palette without offering a text field. */}
        <Command.Input ref={focusRef} value="" readOnly aria-label="confirm" className="sr-only" />
      </div>
      <Command.List className="min-h-0 overflow-y-auto py-1">
        {preview?.count ? (
          <>
            <Group heading="confirm">
              <Item value="confirm" disabled={busy} onSelect={() => onConfirm(preview)}>
                <span className="flex-1">
                  {isKeepOut(preview)
                    ? `keep out ${plural(preview.count, "sender")}${preview.spam ? " as spam" : ""}`
                    : `${mode.label} ${plural(preview.count, "thread")}`}
                </span>
                <Kbd keys="enter" />
              </Item>
            </Group>
            {isKeepOut(preview) ? (
              <Group heading="senders">
                {preview.senders.slice(0, 100).map((s) => (
                  <div key={s.id} className="flex h-touch items-center gap-2 px-3 text-text-muted md:h-row">
                    <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
                    <span className="shrink-0 text-11">{s.threads ? `${plural(s.threads, "thread")} out` : "nothing to move"}</span>
                  </div>
                ))}
                {preview.count > 100 ? <Line>and {preview.count - 100} more</Line> : null}
              </Group>
            ) : (
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
            )}
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
        "palette-row flex h-touch cursor-default items-center gap-2 border-l-2 border-transparent pr-3 pl-2 transition-colors duration-80 ease-snap md:h-row",
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
