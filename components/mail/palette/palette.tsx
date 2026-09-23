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
import { useKeys } from "../keys/keymap";
import { useAccountToggles, type ToggleAccount } from "../account-toggles";
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
export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [openPalette] = useState(() => () => setOpen(true));
  useKeys([
    { keys: "mod+k", label: "palette", group: "general", allowInInput: true, run: () => setOpen((o) => !o) },
    { keys: "/", label: "search", group: "general", run: openPalette },
  ]);
  return (
    <PaletteContext.Provider value={openPalette}>
      {children}
      {open ? <PaletteDialog onClose={() => setOpen(false)} /> : null}
    </PaletteContext.Provider>
  );
}

type Mode = { kind: "search" } | { kind: "preview"; key: string; label: string; preview: ActionPreview | null };

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const { accounts, toggle } = useAccountToggles();
  const router = useRouter();
  const { report } = useUndo();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState<{ input: string; result: PaletteSearch } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const query = input.trim();
  useEffect(() => {
    if (!query) return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      paletteSearch(query)
        .then((result) => {
          if (id === request.current) setSearch({ input: query, result });
        })
        .catch(() => {
          if (id === request.current) setSearch({ input: query, result: { hits: [], total: 0, words: [], counts: {} } });
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const back = () => (mode.kind === "preview" ? setMode({ kind: "search" }) : onClose());
  useKeys(
    [
      { keys: "escape", allowInInput: true, run: back },
      { keys: "mod+k", allowInInput: true, run: onClose },
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
        report(`${label} preview failed, retry`);
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
      report(`${preview.action.type} failed, retry`);
      setBusy(false);
    }
  };

  const current = search && search.input === query ? search.result : null;
  const words = current?.words ?? [];
  const nav = navItems(accounts).filter(
    (item) => !query || item.label.toLowerCase().includes(query.toLowerCase()),
  );
  const colorOf = new Map(accounts.map((a) => [a.id, a.color]));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/60 px-4 pt-palette-top pb-palette-top" onClick={onClose}>
      <Command
        label="palette"
        shouldFilter={false}
        loop
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-palette flex-col overflow-hidden rounded-md border border-border bg-surface-top"
      >
        {mode.kind === "search" ? (
          <>
            <Command.Input
              autoFocus
              value={input}
              onValueChange={setInput}
              placeholder="search mail, go to, act on results"
              className="h-touch w-full shrink-0 border-b border-border bg-transparent px-3 outline-none placeholder:text-text-dim"
            />
            <Command.List className="min-h-0 overflow-y-auto py-1">
              {query && !current ? <Line>searching</Line> : null}
              {query && current && !current.hits.length && !nav.length ? (
                <Command.Empty>
                  <Line>no matches</Line>
                </Command.Empty>
              ) : null}

              {nav.length ? (
                <Group heading="go to">
                  {nav.map((item) => (
                    <Item
                      key={item.label}
                      value={`nav:${item.label}`}
                      onSelect={() => ("toggle" in item ? toggle(item.toggle) : go(item.href))}
                    >
                      <span className="flex-1">{item.label}</span>
                      {item.hint ? <Kbd keys={item.hint} /> : null}
                    </Item>
                  ))}
                </Group>
              ) : null}

              {current?.hits.length ? (
                <Group
                  heading={
                    current.total > VISIBLE_HITS
                      ? `top ${VISIBLE_HITS} of ${current.total} threads`
                      : `${current.total} ${current.total === 1 ? "thread" : "threads"}`
                  }
                >
                  {current.hits.slice(0, VISIBLE_HITS).map((hit) => (
                    <Item
                      key={hit.id}
                      value={`thread:${hit.id}`}
                      onSelect={() => go(mailHref(BUCKET_VIEW[hit.bucket], { threadId: hit.id }))}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0"
                        style={{ backgroundColor: colorOf.get(hit.accountId) ?? "var(--text-dim)" }}
                      />
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
                </Group>
              ) : null}

              {current?.total ? (
                <Group heading="act on results">
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
                </Group>
              ) : null}
            </Command.List>
            <div className="flex h-status shrink-0 items-center gap-4 border-t border-border px-3 text-11 text-text-dim">
              <span>from: account: before: after:</span>
              <KeyHints className="ml-auto" hints={[["enter", "select"], ["escape", "close"]]} />
            </div>
          </>
        ) : (
          <PreviewPane mode={mode} busy={busy} onConfirm={execute} onBack={() => setMode({ kind: "search" })} />
        )}
      </Command>
    </div>
  );
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

type NavItem = { label: string; hint: string } & ({ href: string } | { toggle: string });

function navItems(accounts: ToggleAccount[]): NavItem[] {
  return [
    ...VIEWS.map((v) => ({ label: v.label, href: mailHref(v.slug), hint: v.goKey ? `g ${v.goKey}` : "" })),
    // Same as the header toggles; the palette stays open.
    ...(accounts.length > 1
      ? accounts.map((a) => ({ label: `${a.on ? "hide" : "show"} ${a.label}`, toggle: a.id, hint: "" }))
      : []),
    { label: "settings", href: "/settings", hint: "" },
  ];
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:text-text-dim"
    >
      {children}
    </Command.Group>
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
