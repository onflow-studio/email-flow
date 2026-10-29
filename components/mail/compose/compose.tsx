"use client";

import { ArrowLeft, Minus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { discardDraft, prepareCompose, saveDraft, sendCompose } from "@/app/(mail)/_compose/actions";
import { MODE_LABELS, type ComposeAccount, type ComposeInit, type ComposeMode, type ComposeSend } from "@/app/(mail)/_compose/types";
import { Button } from "@/components/ui/button";
import { KeyHints } from "@/components/ui/kbd";
import { Countdown, dismissToast, showToast, ToastCard } from "@/components/ui/toast";
import { encodedBytes, MAX_MESSAGE_BYTES, UPLOAD_PART_BYTES } from "@/lib/mail/attach";
import { cn } from "@/lib/utils";

import { UNDO_MS, useUndo } from "../actions/undo";
import { useKeys, useShortcut } from "../keys/keymap";
import { bodyHtml, ComposeBody, ComposeToolbar, useComposeEditor } from "./editor";
import { readLastAccount, rememberAccount } from "./last-account";
import { RecipientInput } from "./recipient-input";

type Session = {
  key: number;
  mode: ComposeMode;
  threadId: string | null;
  accountHint: string | null;
  draftId: string | null;
  /** Recipients to start a new message with, e.g. from a person card. */
  to?: string;
};

// Quiet time after the last keystroke before the draft is saved to Gmail.
const AUTOSAVE_MS = 1500;

type ComposeContextValue = {
  /** Opens compose. While an edited draft is open it only brings that one back, so it is never lost. */
  open: (mode: ComposeMode, threadId?: string | null, accountHint?: string | null, to?: string) => void;
  /** Resumes a saved draft. Same rule as `open`. */
  openDraft: (draftId: string) => void;
  isOpen: boolean;
  /** Registers what the sent toast's `done` runs on a Work thread; returns the unregister. */
  onDone: (handler: (threadId: string) => void) => () => void;
};

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function useCompose() {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error("useCompose must be used inside <ComposeProvider>");
  return ctx;
}

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Minimized: compose shrinks to a bar and the app's keys work again; the draft keeps saving.
  const [minimized, setMinimized] = useState(false);
  const { notify } = useUndo();
  const dirty = useRef(false);

  const open = useCallback(
    (mode: ComposeMode, threadId: string | null = null, accountHint: string | null = null, to?: string) => {
      setMinimized(false);
      if (session && (dirty.current || (session.mode === mode && session.threadId === threadId && !to))) return;
      dirty.current = false;
      setSession({ key: Date.now(), mode, threadId, accountHint, draftId: null, to });
    },
    [session],
  );

  const openDraft = useCallback(
    (draftId: string) => {
      setMinimized(false);
      if (session && (dirty.current || session.draftId === draftId)) return;
      dirty.current = false;
      setSession({ key: Date.now(), mode: "new", threadId: null, accountHint: null, draftId });
    },
    [session],
  );

  const close = useCallback(() => {
    dirty.current = false;
    setMinimized(false);
    setSession(null);
  }, []);

  const doneRef = useRef<((threadId: string) => void) | null>(null);
  const onDone = useCallback((handler: (threadId: string) => void) => {
    doneRef.current = handler;
    return () => {
      if (doneRef.current === handler) doneRef.current = null;
    };
  }, []);

  const sent = useCallback(
    (notice: string, workThreadId: string | null) => {
      if (!workThreadId) return notify(notice, "success");
      // A reply on a Work thread: offer done while the toast shows.
      const id = `sent-${Date.now()}`;
      showToast(
        () => (
          <SentToast
            message={notice}
            onDone={() => {
              dismissToast(id);
              doneRef.current?.(workThreadId);
            }}
          />
        ),
        { id, duration: UNDO_MS },
      );
    },
    [notify],
  );

  const value = useMemo(() => ({ open, openDraft, isOpen: !!session, onDone }), [open, openDraft, session, onDone]);

  // A file dropped anywhere but compose would open in the tab and leave the app. Compose takes
  // its own drops first; everywhere else refuses them.
  useEffect(() => {
    const refuse = (e: DragEvent) => {
      if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);

  return (
    <ComposeContext.Provider value={value}>
      {children}
      {session ? (
        <ComposePanel
          key={session.key}
          session={session}
          dirtyRef={dirty}
          minimized={minimized}
          setMinimized={setMinimized}
          onClose={close}
          onSent={sent}
          onNotice={notify}
        />
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

const hasFiles = (data: DataTransfer | null) => !!data && Array.from(data.types).includes("Files");

/** Sends a file to the server in parts, see app/api/uploads. Resolves to its upload id. */
async function upload(file: File, signal: AbortSignal): Promise<string> {
  let id: string | null = null;
  for (let part = 0; part === 0 || part * UPLOAD_PART_BYTES < file.size; part++) {
    const params = new URLSearchParams({ part: String(part), name: file.name || "attachment", type: file.type });
    if (id) params.set("id", id);
    const start = part * UPLOAD_PART_BYTES;
    const res = await fetch(`/api/uploads?${params}`, {
      method: "POST",
      body: file.slice(start, start + UPLOAD_PART_BYTES),
      signal,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    id = ((await res.json()) as { id: string }).id;
  }
  return id!;
}

type Attached = { key: number; name: string; size: number; status: "uploading" | "ready" | "failed" };
type UploadJob = { abort: AbortController; done: Promise<string | null> };

/** Stops an upload and removes what reached the server. */
function cancelUpload(job: UploadJob) {
  job.abort.abort();
  void job.done.then((id) => {
    if (id) fetch(`/api/uploads?id=${id}`, { method: "DELETE" }).catch(() => {});
  });
}

function ComposePanel({
  session,
  dirtyRef,
  minimized,
  setMinimized,
  onClose,
  onSent,
  onNotice,
}: {
  session: Session;
  dirtyRef: React.RefObject<boolean>;
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
  onClose: () => void;
  /** `workThreadId`: the reply went to a Work thread, which the toast can then finish. */
  onSent: (notice: string, workThreadId: string | null) => void;
  onNotice: (message: string, type: "success" | "error") => void;
}) {
  const router = useRouter();
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
  const [bodyRev, setBodyRev] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const toRef = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  // Files attached here, uploading as soon as they are added. Sent with the message, not kept in the draft.
  const [attached, setAttached] = useState<Attached[]>([]);
  const uploads = useRef(new Map<number, UploadJob>());
  const nextUpload = useRef(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const { editor, insertFiles } = useComposeEditor({
    placeholder: session.mode === "forward" ? "add a note" : "write",
    onUpdate: (e) => {
      setBodyEmpty(e.isEmpty);
      setBodyRev((r) => r + 1);
    },
    onAttach: (files) => attach(files),
    onSubmit: () => send(),
    onEscape: () => escape(),
  });

  useEffect(() => {
    let live = true;
    prepareCompose(session.mode, session.threadId, session.draftId)
      .then((result) => {
        if (!live) return;
        if (!result) return setLoadError("thread not found, close and reload");
        setInit(result);
        setAccountId(result.accountId ?? defaultAccount(result.accounts, session.accountHint));
        setTo(session.to || result.to);
        setCc(result.cc);
        setShowCc(!!result.cc);
        setBcc(result.bcc);
        setShowBcc(!!result.bcc);
        setSubject(result.subject);
        setBodyEmpty(!result.html);
        draftIdRef.current = result.draftId;
      })
      .catch(() => live && setLoadError("could not open compose, retry"));
    return () => {
      live = false;
    };
  }, [session]);

  // Replies start in the body, everything else at the recipients. A resumed draft starts at the end of its body.
  useEffect(() => {
    if (!init || !editor) return;
    if (init.html) {
      editor.commands.setContent(init.html, { emitUpdate: false });
      editor.commands.focus("end");
    } else if (init.mode === "reply" || init.mode === "reply-all") editor.commands.focus("start");
    else toRef.current?.focus();
  }, [init, editor]);

  const edited =
    !bodyEmpty ||
    attached.length > 0 ||
    (!!init && (to !== init.to || cc !== init.cc || bcc !== init.bcc || subject !== init.subject || dropped.size > 0));
  useEffect(() => {
    dirtyRef.current = edited;
  }, [edited, dirtyRef]);

  // Autosave: the form is saved as a Gmail draft once typing pauses. Saves run one after another so the
  // first one's draft id reaches the next. `snapshot` changes with every edit; `saved` is the last one stored.
  const draftIdRef = useRef<string | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saved = useRef<string | null>(null);
  const snapshot = init ? JSON.stringify([accountId, to, cc, bcc, subject, bodyRev]) : null;
  const latest = useRef({ snapshot, edited, form: null as (() => ComposeSend) | null });
  useEffect(() => {
    latest.current = {
      snapshot,
      edited,
      form: () => ({
        mode: init!.mode,
        threadId: init!.threadId,
        accountId,
        to,
        cc,
        bcc,
        subject,
        html: bodyHtml(editor),
        attachmentIds: init!.attachments.filter((a) => !dropped.has(a.id)).map((a) => a.id),
        draftId: draftIdRef.current,
      }),
    };
    if (saved.current === null) saved.current = snapshot;
  });

  const persist = useCallback(() => {
    saving.current = saving.current.then(async () => {
      const { snapshot: snap, edited: changed, form } = latest.current;
      if (!form || snap === saved.current) return;
      // Nothing typed yet: no draft to keep.
      if (!draftIdRef.current && !changed) return;
      setSaveState("saving");
      const result = await saveDraft(form()).catch(() => ({ ok: false as const, error: "draft not saved" }));
      if (result.ok) {
        draftIdRef.current = result.draftId;
        saved.current = snap;
        setSaveState("saved");
      } else {
        setSaveState({ error: result.error });
      }
    });
    return saving.current;
  }, []);

  useEffect(() => {
    if (!snapshot || snapshot === saved.current || sending) return;
    const timer = setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, sending, persist]);

  const account = init?.accounts.find((a) => a.id === accountId) ?? null;
  const threadMode = session.mode !== "new";

  /** Adds files as attachments, refusing any that would take the message over Gmail's limit. */
  const attach = (files: File[]) => {
    if (!init) return;
    let total =
      (editor?.getHTML().length ?? 0) +
      init.attachments.filter((a) => !dropped.has(a.id)).reduce((n, a) => n + encodedBytes(a.size), 0) +
      attached.reduce((n, a) => n + encodedBytes(a.size), 0);
    const added: Attached[] = [];
    for (const file of files) {
      if (total + encodedBytes(file.size) > MAX_MESSAGE_BYTES) {
        setError(`${file.name} would take the message over 35 mb`);
        continue;
      }
      total += encodedBytes(file.size);
      const key = nextUpload.current++;
      const abort = new AbortController();
      const mark = (status: Attached["status"]) =>
        setAttached((prev) => prev.map((a) => (a.key === key ? { ...a, status } : a)));
      const done = upload(file, abort.signal).then(
        (id) => {
          mark("ready");
          return id;
        },
        () => {
          if (!abort.signal.aborted) mark("failed");
          return null;
        },
      );
      uploads.current.set(key, { abort, done });
      added.push({ key, name: file.name || "attachment", size: file.size, status: "uploading" });
    }
    if (added.length) setAttached((prev) => [...prev, ...added]);
  };

  const detach = (key: number) => {
    const job = uploads.current.get(key);
    uploads.current.delete(key);
    setAttached((prev) => prev.filter((a) => a.key !== key));
    if (job) cancelUpload(job);
  };

  /** Removes every attached file from the server; true when there were any. */
  const dropUploads = () => {
    const any = uploads.current.size > 0;
    for (const job of uploads.current.values()) cancelUpload(job);
    uploads.current.clear();
    return any;
  };

  const send = () => {
    const form = latest.current.form;
    if (!init || !editor || !form || sending) return;
    setError(null);
    startSend(async () => {
      // A save in flight may be creating the draft; wait so send removes it.
      await saving.current;
      const uploadIds = await Promise.all([...uploads.current.values()].map((job) => job.done));
      if (uploadIds.some((id) => !id)) return setError("a file did not upload, remove it and attach it again");
      const result = await sendCompose({ ...form(), uploadIds: uploadIds as string[] });
      if (result.ok) {
        rememberAccount(result.accountId);
        onSent(`sent from ${result.accountLabel}`, result.work ? init.threadId : null);
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  /** Closes and keeps the draft: whatever is unsaved is saved on the way out. */
  const close = () => {
    if (sending) return;
    const pending = latest.current.snapshot !== saved.current && (draftIdRef.current || latest.current.edited);
    const hadFiles = dropUploads();
    onClose();
    if (!pending) {
      if (hadFiles) onNotice("attached files are not kept in drafts", "error");
      return;
    }
    void persist().then(() => {
      if (draftIdRef.current) {
        onNotice(hadFiles ? "draft saved without the attached files" : "draft saved", "success");
        router.refresh();
      } else {
        onNotice("draft not saved", "error");
      }
    });
  };

  const discard = () => {
    if (sending) return;
    dropUploads();
    onClose();
    // Wait for a save in flight so its draft is the one removed.
    void saving.current.then(async () => {
      if (!draftIdRef.current) return;
      const result = await discardDraft(draftIdRef.current);
      if (!result.ok) onNotice("could not discard the draft", "error");
      router.refresh();
    });
  };

  const escape = () => {
    if (linkOpen) return setLinkOpen(false);
    close();
  };

  const minimize = () => {
    setLinkOpen(false);
    setMinimized(true);
  };
  const restore = () => setMinimized(false);
  // Back from the bar, by a click or by compose being asked for again: the body takes the keys.
  const wasMinimized = useRef(minimized);
  useEffect(() => {
    if (wasMinimized.current && !minimized) editor?.commands.focus();
    wasMinimized.current = minimized;
  }, [minimized, editor]);

  const sendKey = useShortcut("compose.send");
  const minimizeKey = useShortcut("compose.minimize");
  const open = () => !minimized;
  useKeys(
    [
      { id: "compose.send", allowInInput: true, when: open, run: send },
      { id: "compose.close", allowInInput: true, when: open, run: escape },
      { id: "compose.link", allowInInput: true, when: open, run: () => setLinkOpen((o) => !o) },
      { id: "compose.attach", allowInInput: true, when: open, run: () => attachInput.current?.click() },
      { id: "compose.minimize", allowInInput: true, run: () => (minimized ? restore() : minimize()) },
    ],
    // Minimized, the app's own keys work again. Open, only the palette reaches past compose.
    { exclusive: !minimized, except: ["palette"] },
  );

  const modeLabel = MODE_LABELS[session.mode];
  let footerNote: React.ReactNode = null;
  if (error) footerNote = <span className="text-danger">{error}</span>;
  else if (sending) footerNote = <span className="text-text-muted">sending</span>;
  else if (typeof saveState === "object") footerNote = <span className="text-danger">{saveState.error}</span>;
  else if (saveState === "saving") footerNote = <span className="text-text-dim">saving draft</span>;
  else if (saveState === "saved") footerNote = <span className="text-text-dim">draft saved</span>;

  return (
    <div
      role="dialog"
      aria-label={`${modeLabel} message`}
      className={cn(
        "fixed z-40 flex flex-col bg-surface-top md:inset-auto md:right-4 md:w-compose md:rounded-md md:border md:border-border",
        minimized ? "inset-x-0 bottom-compose-min border-y border-border md:bottom-compose-min" : "inset-0 md:bottom-status md:max-h-compose-h",
      )}
      // Files dropped anywhere on compose are attached. The body takes images itself, inline, and
      // marks the drop handled.
      onDragEnter={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e.dataTransfer) || --dragDepth.current > 0) return;
        dragDepth.current = 0;
        setDragging(false);
      }}
      onDragOver={(e) => {
        if (hasFiles(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        attach(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-dashed border-accent md:rounded-md"
        >
          <span className="rounded-sm bg-surface-raised px-2 py-1 text-11 text-text">drop to attach</span>
        </div>
      ) : null}
      {minimized ? (
        // The bar: a click anywhere but close brings compose back.
        <div className="flex h-touch shrink-0 items-center gap-3 px-3 md:h-row">
          <button
            type="button"
            onClick={restore}
            title={minimizeKey ? `open  ${minimizeKey}` : "open"}
            className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:text-accent"
          >
            <span className="shrink-0 font-medium">{modeLabel}</span>
            {account ? <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: account.color }} /> : null}
            <span className={cn("min-w-0 flex-1 truncate", subject ? "text-text-muted" : "text-text-dim")}>{subject || "no subject"}</span>
          </button>
          <span role="status" className="shrink-0 text-11">
            {footerNote}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="close"
            title="close, the draft is kept"
            className="-mr-1 flex size-touch shrink-0 items-center justify-center text-text-muted transition-colors duration-80 ease-snap hover:text-text focus-visible:text-accent md:size-6"
          >
            <X aria-hidden className="size-3" strokeWidth={1.5} />
          </button>
        </div>
      ) : (
      <header className="flex h-touch shrink-0 items-center gap-3 border-b border-border px-3 md:h-row">
        <button
          type="button"
          onClick={close}
          aria-label="close"
          className="-ml-1 flex size-touch items-center justify-center text-text-muted md:hidden"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
        </button>
        <span className="font-medium">{modeLabel}</span>
        {account ? (
          <span className="flex items-center gap-2 text-11 text-text-muted">
            <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: account.color }} />
            {account.label}
          </span>
        ) : null}
        <KeyHints className="ml-auto text-11 text-text-dim" hints={[["escape", "close"]]} />
        <button
          type="button"
          onClick={minimize}
          aria-label="minimize"
          title={minimizeKey ? `minimize  ${minimizeKey}` : "minimize"}
          className="flex size-touch shrink-0 items-center justify-center text-text-muted transition-colors duration-80 ease-snap hover:text-text focus-visible:text-accent max-md:ml-auto md:-mr-1 md:size-6"
        >
          <Minus aria-hidden className="size-3" strokeWidth={1.5} />
        </button>
        <Button variant="primary" onClick={send} disabled={!init || sending} className="md:hidden">
          {sending ? "sending" : "send"}
        </Button>
      </header>
      )}

      {loadError ? (
        <p className={cn("p-3 text-danger", minimized && "hidden")}>{loadError}</p>
      ) : (
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", minimized && "hidden")}>
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
                    <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: a.color }} />
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
            <RecipientInput
              id="compose-to"
              ref={toRef}
              value={to}
              onChange={setTo}
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
              <RecipientInput
                id="compose-cc"
                autoFocus={!init?.cc}
                value={cc}
                onChange={setCc}
                className={fieldInput}
              />
            </div>
          ) : null}
          {showBcc ? (
            <div className={field}>
              <label htmlFor="compose-bcc" className={fieldLabel}>
                bcc
              </label>
              <RecipientInput
                id="compose-bcc"
                autoFocus
                value={bcc}
                onChange={setBcc}
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
            attachInput={attachInput}
            onAttach={attach}
          />
          <div className="flex-1">
            <ComposeBody editor={editor} />
          </div>

          {account?.signature || init?.quoting || init?.attachments.length || attached.length ? (
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
              {attached.map((a) => (
                <div key={a.key} className="flex h-touch items-center gap-2 md:h-6">
                  <span className="min-w-0 flex-1 truncate text-text-muted">{a.name}</span>
                  {a.status === "failed" ? (
                    <span className="text-danger">upload failed</span>
                  ) : (
                    <span>{a.status === "uploading" ? "uploading" : formatSize(a.size)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => detach(a.key)}
                    aria-label={`remove ${a.name}`}
                    title="remove"
                    className="-mr-1 flex size-touch shrink-0 items-center justify-center text-text-muted transition-colors duration-80 ease-snap hover:text-text focus-visible:text-accent md:size-6"
                  >
                    <X aria-hidden className="size-3" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <footer className={cn("box-content flex h-touch shrink-0 items-center gap-2 border-t border-border px-3 pb-safe md:h-row md:pb-0", minimized && "hidden")}>
        <Button variant="primary" shortcut={sendKey} onClick={send} disabled={!init || sending} className="hidden md:inline-flex">
          {sending ? "sending" : "send"}
        </Button>
        <Button variant="ghost" onClick={discard} disabled={sending}>
          discard
        </Button>
        <span role="status" className="min-w-0 truncate text-11">
          {footerNote}
        </span>
      </footer>
    </div>
  );
}

function SentToast({ message, onDone }: { message: string; onDone: () => void }) {
  const workKey = useShortcut("work");
  return (
    <ToastCard type="success" message={message}>
      <Button variant="secondary" size="sm" shortcut={workKey} onClick={onDone}>
        done
      </Button>
      <Countdown ms={UNDO_MS} />
    </ToastCard>
  );
}
