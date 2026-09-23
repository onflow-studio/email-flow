"use client";

import { ArrowLeft } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { prepareCompose, sendCompose } from "@/app/(mail)/_compose/actions";
import { MODE_LABELS, type ComposeAccount, type ComposeInit, type ComposeMode } from "@/app/(mail)/_compose/types";
import { Button } from "@/components/ui/button";
import { KeyHints } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { useUndo } from "../actions/undo";
import { useKeys } from "../keys/keymap";
import { ComposeBody, ComposeToolbar, useComposeEditor } from "./editor";
import { readLastAccount, rememberAccount } from "./last-account";

type Session = { key: number; mode: ComposeMode; threadId: string | null; accountHint: string | null };

type ComposeContextValue = {
  /** Opens compose. Ignored while an edited draft is open, so it is never lost. */
  open: (mode: ComposeMode, threadId?: string | null, accountHint?: string | null) => void;
  isOpen: boolean;
};

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function useCompose() {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error("useCompose must be used inside <ComposeProvider>");
  return ctx;
}

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const { report } = useUndo();
  const dirty = useRef(false);

  const open = useCallback(
    (mode: ComposeMode, threadId: string | null = null, accountHint: string | null = null) => {
      if (session && (dirty.current || (session.mode === mode && session.threadId === threadId))) return;
      dirty.current = false;
      setSession({ key: Date.now(), mode, threadId, accountHint });
    },
    [session],
  );

  const close = useCallback(() => {
    dirty.current = false;
    setSession(null);
  }, []);

  const value = useMemo(() => ({ open, isOpen: !!session }), [open, session]);

  return (
    <ComposeContext.Provider value={value}>
      {children}
      {session ? (
        <ComposePanel key={session.key} session={session} dirtyRef={dirty} onClose={close} onSent={report} />
      ) : null}
    </ComposeContext.Provider>
  );
}

function defaultAccount(accounts: ComposeAccount[], hint: string | null): string | null {
  const ids = new Set(accounts.map((a) => a.id));
  const last = readLastAccount();
  if (last && ids.has(last)) return last;
  if (hint && ids.has(hint)) return hint;
  return accounts[0]?.id ?? null;
}

const field = "flex min-h-touch items-center gap-3 border-b border-border px-3 md:min-h-row";
const fieldLabel = "w-label shrink-0 text-11 text-text-muted";
const fieldInput = "h-touch min-w-0 flex-1 bg-transparent text-13 text-text outline-none placeholder:text-text-dim md:h-row";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} mb`;
}

function ComposePanel({
  session,
  dirtyRef,
  onClose,
  onSent,
}: {
  session: Session;
  dirtyRef: React.RefObject<boolean>;
  onClose: () => void;
  onSent: (notice: string) => void;
}) {
  const [init, setInit] = useState<ComposeInit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const toRef = useRef<HTMLInputElement>(null);

  const { editor, insertFiles } = useComposeEditor({
    placeholder: session.mode === "forward" ? "add a note" : "write",
    onUpdate: (e) => {
      setConfirmDiscard(false);
      setBodyEmpty(e.isEmpty);
    },
    onError: setError,
    onSubmit: () => send(),
    onEscape: () => escape(),
  });

  useEffect(() => {
    let live = true;
    prepareCompose(session.mode, session.threadId)
      .then((result) => {
        if (!live) return;
        if (!result) return setLoadError("thread not found, close and reload");
        setInit(result);
        setAccountId(result.accountId ?? defaultAccount(result.accounts, session.accountHint));
        setTo(result.to);
        setCc(result.cc);
        setShowCc(!!result.cc);
        setSubject(result.subject);
      })
      .catch(() => live && setLoadError("could not open compose, retry"));
    return () => {
      live = false;
    };
  }, [session]);

  // Replies start in the body, everything else at the recipients.
  useEffect(() => {
    if (!init || !editor) return;
    if (init.mode === "reply" || init.mode === "reply-all") editor.commands.focus("start");
    else toRef.current?.focus();
  }, [init, editor]);

  const edited =
    !bodyEmpty ||
    (!!init && (to !== init.to || cc !== init.cc || bcc !== "" || subject !== init.subject || dropped.size > 0));
  useEffect(() => {
    dirtyRef.current = edited;
  }, [edited, dirtyRef]);

  const account = init?.accounts.find((a) => a.id === accountId) ?? null;
  const threadMode = session.mode !== "new";

  const send = () => {
    if (!init || !editor || sending) return;
    setError(null);
    setConfirmDiscard(false);
    startSend(async () => {
      const result = await sendCompose({
        mode: init.mode,
        threadId: init.threadId,
        accountId,
        to,
        cc,
        bcc,
        subject,
        // Drop the empty paragraph the editor keeps at the end.
        html: editor.isEmpty ? "" : editor.getHTML().replace(/(<p><\/p>)+$/, ""),
        attachmentIds: init.attachments.filter((a) => !dropped.has(a.id)).map((a) => a.id),
      });
      if (result.ok) {
        rememberAccount(result.accountId);
        onSent(`sent from ${result.accountLabel}`);
        onClose();
      } else {
        setError(result.error);
      }
    });
  };

  const escape = () => {
    if (linkOpen) return setLinkOpen(false);
    if (edited && !confirmDiscard && !sending) return setConfirmDiscard(true);
    onClose();
  };

  useKeys(
    [
      { keys: "mod+enter", label: "send", group: "compose", allowInInput: true, run: send },
      { keys: "escape", label: "close compose", group: "compose", allowInInput: true, run: escape },
      { keys: "mod+k", label: "link", group: "compose", allowInInput: true, run: () => setLinkOpen((o) => !o) },
    ],
    { exclusive: true },
  );

  const modeLabel = MODE_LABELS[session.mode];
  let footerNote: React.ReactNode = null;
  if (confirmDiscard) footerNote = <span className="text-warning">unsent draft, esc again to discard</span>;
  else if (error) footerNote = <span className="text-danger">{error}</span>;
  else if (sending) footerNote = <span className="text-text-muted">sending</span>;

  return (
    <div
      role="dialog"
      aria-label={`${modeLabel} message`}
      className="fixed inset-0 z-40 flex flex-col bg-surface-top md:inset-auto md:right-4 md:bottom-status md:max-h-compose-h md:w-compose md:rounded-md md:border md:border-border"
    >
      <header className="flex h-touch shrink-0 items-center gap-3 border-b border-border px-3 md:h-row">
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="-ml-1 flex size-touch items-center justify-center text-text-muted md:hidden"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
        </button>
        <span className="font-medium">{modeLabel}</span>
        {account ? (
          <span className="flex items-center gap-1 text-11 text-text-muted">
            <span aria-hidden className="h-3 w-0.5" style={{ backgroundColor: account.color }} />
            {account.label}
          </span>
        ) : null}
        <KeyHints className="ml-auto text-11 text-text-dim" hints={[["escape", "close"]]} />
        <Button variant="primary" onClick={send} disabled={!init || sending} className="ml-auto md:hidden">
          {sending ? "sending" : "send"}
        </Button>
      </header>

      {loadError ? (
        <p className="p-3 text-danger">{loadError}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!threadMode && init ? (
            <div role="radiogroup" aria-label="from" className={field}>
              <span className={fieldLabel}>from</span>
              <div className="flex flex-wrap gap-1">
                {init.accounts.map((a) => (
                  <label
                    key={a.id}
                    title={a.email}
                    className="flex h-touch cursor-pointer items-center gap-1 rounded-sm px-2 text-text-muted transition-colors duration-80 ease-snap has-checked:bg-surface-raised has-checked:text-text has-focus-visible:text-text md:h-6"
                  >
                    <input
                      type="radio"
                      name="compose-account"
                      value={a.id}
                      checked={a.id === accountId}
                      onChange={() => setAccountId(a.id)}
                      className="sr-only"
                    />
                    <span aria-hidden className="h-3 w-0.5" style={{ backgroundColor: a.color }} />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className={field}>
            <label htmlFor="compose-to" className={fieldLabel}>
              to
            </label>
            <input
              id="compose-to"
              ref={toRef}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="name@example.com, ..."
              className={fieldInput}
            />
            <span className="flex shrink-0 gap-1">
              {!showCc ? (
                <button type="button" onClick={() => setShowCc(true)} className="h-touch px-1 text-11 text-text-muted hover:text-text md:h-6">
                  cc
                </button>
              ) : null}
              {!showBcc ? (
                <button type="button" onClick={() => setShowBcc(true)} className="h-touch px-1 text-11 text-text-muted hover:text-text md:h-6">
                  bcc
                </button>
              ) : null}
            </span>
          </div>
          {showCc ? (
            <div className={field}>
              <label htmlFor="compose-cc" className={fieldLabel}>
                cc
              </label>
              <input
                id="compose-cc"
                autoFocus={!init?.cc}
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                className={fieldInput}
              />
            </div>
          ) : null}
          {showBcc ? (
            <div className={field}>
              <label htmlFor="compose-bcc" className={fieldLabel}>
                bcc
              </label>
              <input
                id="compose-bcc"
                autoFocus
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                className={fieldInput}
              />
            </div>
          ) : null}
          <div className={field}>
            <label htmlFor="compose-subject" className={fieldLabel}>
              subject
            </label>
            {session.mode === "reply" || session.mode === "reply-all" ? (
              <span id="compose-subject" className="min-w-0 flex-1 truncate text-text-muted">
                {subject}
              </span>
            ) : (
              <input
                id="compose-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoComplete="off"
                className={fieldInput}
              />
            )}
          </div>

          <ComposeToolbar
            editor={editor}
            linkOpen={linkOpen}
            setLinkOpen={setLinkOpen}
            onImages={(files) => editor && insertFiles(editor, files)}
          />
          <div className="flex-1">
            <ComposeBody editor={editor} />
          </div>

          {account?.signature || init?.quoting || init?.attachments.length ? (
            <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-11 text-text-dim">
              {account?.signature ? <p className="truncate">-- {account.signature}</p> : null}
              {init?.quoting ? (
                <p className="truncate">
                  {init.mode === "forward" ? "forwarding" : "quoting"} {init.quoting}
                </p>
              ) : null}
              {init?.attachments.map((a) => {
                const kept = !dropped.has(a.id);
                return (
                  <label key={a.id} className="flex h-touch cursor-pointer items-center gap-2 md:h-6">
                    <input
                      type="checkbox"
                      checked={kept}
                      onChange={() =>
                        setDropped((prev) => {
                          const next = new Set(prev);
                          if (kept) next.add(a.id);
                          else next.delete(a.id);
                          return next;
                        })
                      }
                      className="peer sr-only"
                    />
                    <span aria-hidden className="text-text-muted peer-focus-visible:text-accent">
                      {kept ? "[x]" : "[ ]"}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", kept ? "text-text-muted" : "line-through")}>
                      {a.filename}
                    </span>
                    <span>{formatSize(a.size)}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      <footer className="box-content flex h-touch shrink-0 items-center gap-2 border-t border-border px-3 pb-safe md:h-row md:pb-0">
        <Button variant="primary" shortcut="mod+enter" onClick={send} disabled={!init || sending} className="hidden md:inline-flex">
          {sending ? "sending" : "send"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={sending}>
          discard
        </Button>
        <span role="status" className="min-w-0 truncate text-11">
          {footerNote}
        </span>
      </footer>
    </div>
  );
}
