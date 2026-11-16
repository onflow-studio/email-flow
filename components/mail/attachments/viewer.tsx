"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { attachmentUrl, opensInline, previewKind, type PreviewKind } from "@/lib/mail/remote";
import { cn } from "@/lib/utils";

import { useUndo } from "../actions/undo";
import { useKeys, useShortcut } from "../keys/keymap";
import {
  fetchInParts,
  formatSize,
  needsParts,
  PREVIEW_MAX_BYTES,
  saveAs,
  TEXT_MAX_BYTES,
  type AttachmentFile,
} from "./files";

type Mode = "pane" | "overlay";

// Pane or overlay, per browser. Keeps the app's former name like every other stored key.
const MODE_KEY = "superfer.attachmentViewer";

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "overlay" ? "overlay" : "pane";
  } catch {
    return "pane";
  }
}

function storeMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

export type AttachmentViewerState = {
  files: AttachmentFile[];
  index: number | null;
  mode: Mode;
  open: (id: string) => void;
  close: () => void;
  step: (dir: 1 | -1) => void;
  toggleMode: () => void;
};

const ViewerContext = createContext<AttachmentViewerState | null>(null);

export const AttachmentViewerProvider = ViewerContext.Provider;

/** The thread's viewer, or null outside a reading pane. */
export function useAttachmentViewer() {
  return useContext(ViewerContext);
}

/**
 * The viewer's state for one thread. `scroller` is the pane the thread scrolls in: opening in the
 * pane hides the thread, and closing puts it back where it was, with focus on what opened it.
 */
export function useAttachmentViewerState(files: AttachmentFile[], scroller: () => HTMLElement | null): AttachmentViewerState {
  const [index, setIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("pane");
  const back = useRef<{ top: number; focus: HTMLElement | null } | null>(null);

  const open = useCallback(
    (id: string) => {
      const i = files.findIndex((f) => f.id === id);
      if (i < 0) return;
      if (!back.current) {
        const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        back.current = { top: scroller()?.scrollTop ?? 0, focus };
        setMode(readMode());
      }
      setIndex(i);
    },
    [files, scroller],
  );
  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i === null ? i : Math.min(files.length - 1, Math.max(0, i + dir)))),
    [files.length],
  );
  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === "pane" ? "overlay" : "pane";
      storeMode(next);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (index !== null || !back.current) return;
    const { top, focus } = back.current;
    back.current = null;
    const el = scroller();
    if (el) el.scrollTop = top;
    focus?.focus({ preventScroll: true });
  }, [index, scroller]);

  return { files, index, mode, open, close, step, toggleMode };
}

/** The open attachment, in the reading pane or over the whole app. */
export function AttachmentViewer() {
  const viewer = useAttachmentViewer();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  if (!viewer || viewer.index === null) return null;
  const file = viewer.files[viewer.index];
  const overlay = viewer.mode === "overlay";
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal={overlay}
      aria-label={`attachment ${file.filename}`}
      className={cn(
        // Phone: always the overlay.
        "fixed inset-0 z-50 flex flex-col bg-surface-top outline-none",
        !overlay && "md:relative md:inset-auto md:z-auto md:h-full md:bg-surface",
      )}
    >
      <ViewerFile key={file.id} file={file} viewer={viewer} />
    </div>
  );
}

type Source =
  | { state: "loading"; progress: number | null }
  | { state: "ready"; url: string | null; text?: string; truncated?: boolean }
  | { state: "error" };

type Kind = PreviewKind | "too-large";

/** Fetches what the body shows. Files over the route's single-response size come down in parts. */
function useSource(file: AttachmentFile, kind: Kind, attempt: number): Source {
  const direct = kind === "image" || kind === "pdf" ? !needsParts(file) : false;
  // An empty text file has nothing to fetch.
  const empty = kind === "text" && file.size === 0;
  const [source, setSource] = useState<Source>(() =>
    kind === "other" || kind === "too-large"
      ? { state: "ready", url: null }
      : empty
        ? { state: "ready", url: null, text: "" }
        : direct
        ? { state: "ready", url: attachmentUrl(file.id, { inline: true }) }
        : { state: "loading", progress: needsParts(file) && kind !== "text" ? 0 : null },
  );

  useEffect(() => {
    if (kind === "other" || kind === "too-large" || direct || empty) return;
    const controller = new AbortController();
    let url: string | null = null;
    if (kind === "text") {
      fetch(attachmentUrl(file.id, { inline: true }), { headers: { Range: `bytes=0-${TEXT_MAX_BYTES - 1}` }, signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const total = Number(res.headers.get("content-range")?.split("/")[1]);
          const text = await res.text();
          setSource({ state: "ready", url: null, text, truncated: Number.isFinite(total) && total > TEXT_MAX_BYTES });
        })
        .catch(() => !controller.signal.aborted && setSource({ state: "error" }));
    } else {
      fetchInParts(file, { signal: controller.signal, onProgress: (p) => setSource({ state: "loading", progress: p }) })
        .then((blob) => {
          url = URL.createObjectURL(blob);
          setSource({ state: "ready", url });
        })
        .catch(() => !controller.signal.aborted && setSource({ state: "error" }));
    }
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, kind, direct, empty, attempt]);

  return source;
}

// The phone's bottom bar: 44px targets, no keyboard hints.
const touchButton = "flex h-touch items-center px-3 text-text disabled:text-text-dim";

const percent = (p: number) => `${Math.round(p * 100)}%`;

function ViewerFile({ file, viewer }: { file: AttachmentFile; viewer: AttachmentViewerState }) {
  const { notify } = useUndo();
  const kind: Kind = file.size > PREVIEW_MAX_BYTES ? "too-large" : previewKind(file.mimeType);
  const [attempt, setAttempt] = useState(0);
  const loaded = useSource(file, kind, attempt);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const source: Source = kind === "image" && loaded.state === "ready" && imageState === "error" ? { state: "error" } : loaded;
  // An image is still loading until it has decoded.
  const decoding = kind === "image" && loaded.state === "ready" && imageState === "loading";
  const [actual, setActual] = useState(false);
  // A fetch in parts for `download` or `open`, with its progress.
  const [busy, setBusy] = useState<{ action: "downloading" | "opening"; progress: number } | null>(null);
  const index = viewer.index ?? 0;
  const count = viewer.files.length;
  const overlay = viewer.mode === "overlay";

  const download = async () => {
    if (busy) return;
    if (!needsParts(file)) return saveAs(attachmentUrl(file.id), file.filename);
    if (loaded.state === "ready" && loaded.url) return saveAs(loaded.url, file.filename);
    setBusy({ action: "downloading", progress: 0 });
    try {
      const url = URL.createObjectURL(
        await fetchInParts(file, { onProgress: (progress) => setBusy({ action: "downloading", progress }) }),
      );
      saveAs(url, file.filename);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      notify(`download of ${file.filename} failed, retry`, "error");
    } finally {
      setBusy(null);
    }
  };

  const openInTab = async () => {
    if (!opensInline(file.mimeType)) return void download();
    if (!needsParts(file)) return void window.open(attachmentUrl(file.id, { inline: true }), "_blank", "noopener,noreferrer");
    if (loaded.state === "ready" && loaded.url) return void window.open(loaded.url, "_blank");
    // An image or PDF on its way to a Blob: that Blob is what opens.
    if (loaded.state === "loading" && kind !== "text") {
      return notify(`${file.filename} is still loading, open it again in a moment`, "default");
    }
    // No Blob is coming: text shows only its first part, a too-large file loads nothing, or the
    // load failed. Fetch it here. The tab opens now, while the key or tap still counts as a user
    // action, so the popup blocker lets it through after the await.
    if (busy) return;
    const tab = window.open("", "_blank");
    if (!tab) return notify(`the browser blocked the tab for ${file.filename}, download it instead`, "error");
    tab.opener = null;
    setBusy({ action: "opening", progress: 0 });
    try {
      const url = URL.createObjectURL(await fetchInParts(file, { onProgress: (progress) => setBusy({ action: "opening", progress }) }));
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab.close();
      notify(`opening ${file.filename} failed, retry`, "error");
    } finally {
      setBusy(null);
    }
  };

  const retry = () => {
    setImageState("loading");
    setAttempt((a) => a + 1);
  };

  useKeys(
    [
      { id: "viewer.next", run: () => viewer.step(1) },
      { id: "viewer.prev", run: () => viewer.step(-1) },
      { id: "viewer.download", run: () => void download() },
      { id: "viewer.open", run: () => void openInTab() },
      { id: "viewer.expand", run: viewer.toggleMode },
      { id: "viewer.zoom", when: () => kind === "image", run: () => setActual((a) => !a) },
      { id: "viewer.close", run: viewer.close },
    ],
    { exclusive: true },
  );

  const keys = {
    prev: useShortcut("viewer.prev"),
    next: useShortcut("viewer.next"),
    zoom: useShortcut("viewer.zoom"),
    open: useShortcut("viewer.open"),
    download: useShortcut("viewer.download"),
    expand: useShortcut("viewer.expand"),
    close: useShortcut("viewer.close"),
  };
  const counter = `${index + 1} / ${count}`;

  return (
    <>
      <header className="flex h-header shrink-0 items-center gap-2 border-b border-border px-3">
        <span title={file.filename} className="min-w-0 truncate font-medium text-text">
          {file.filename}
        </span>
        <span className="shrink-0 text-11 text-text-muted tabular-nums">{counter}</span>
        <span className="shrink-0 text-11 text-text-muted tabular-nums">{formatSize(file.size)}</span>
        {busy ? (
          <span className="shrink-0 text-11 text-text-muted tabular-nums">
            <span className="hidden md:inline">{busy.action} </span>
            {percent(busy.progress)}
          </span>
        ) : null}
        <span className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
          <Button variant="ghost" size="sm" shortcut={keys.prev} disabled={index === 0} onClick={() => viewer.step(-1)}>
            prev
          </Button>
          <Button variant="ghost" size="sm" shortcut={keys.next} disabled={index === count - 1} onClick={() => viewer.step(1)}>
            next
          </Button>
          {kind === "image" ? (
            <Button variant="ghost" size="sm" shortcut={keys.zoom} onClick={() => setActual(!actual)}>
              {actual ? "fit" : "1:1"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" shortcut={keys.open} onClick={() => void openInTab()}>
            open
          </Button>
          <Button variant="ghost" size="sm" shortcut={keys.download} onClick={() => void download()}>
            download
          </Button>
          <Button variant="ghost" size="sm" shortcut={keys.expand} onClick={viewer.toggleMode}>
            {overlay ? "pane" : "full screen"}
          </Button>
          <Button variant="ghost" size="sm" shortcut={keys.close} onClick={viewer.close}>
            close
          </Button>
        </span>
        <button type="button" onClick={viewer.close} className="ml-auto flex h-touch shrink-0 items-center px-2 text-text-muted md:hidden">
          close
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-bg">
        <Body
          file={file}
          kind={kind}
          source={source}
          decoding={decoding}
          actual={actual}
          onImage={setImageState}
          onRetry={retry}
          onDownload={() => void download()}
          downloadKey={keys.download}
        />
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border bg-surface-top pb-safe box-content md:hidden">
        <button type="button" disabled={index === 0} onClick={() => viewer.step(-1)} className={touchButton}>
          prev
        </button>
        <span className="flex items-center">
          {kind === "image" ? (
            <button type="button" onClick={() => setActual(!actual)} className={touchButton}>
              {actual ? "fit" : "1:1"}
            </button>
          ) : null}
          <button type="button" onClick={() => void openInTab()} className={touchButton}>
            open
          </button>
          <button type="button" onClick={() => void download()} className={touchButton}>
            download
          </button>
        </span>
        <button type="button" disabled={index === count - 1} onClick={() => viewer.step(1)} className={touchButton}>
          next
        </button>
      </footer>
    </>
  );
}

function Body({
  file,
  kind,
  source,
  decoding,
  actual,
  onImage,
  onRetry,
  onDownload,
  downloadKey,
}: {
  file: AttachmentFile;
  kind: Kind;
  source: Source;
  decoding: boolean;
  actual: boolean;
  onImage: (state: "ready" | "error") => void;
  onRetry: () => void;
  onDownload: () => void;
  downloadKey: string | undefined;
}) {
  if (source.state === "error") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-3 text-12">
        <p className="text-danger">couldn&apos;t load {file.filename}</p>
        <span className="flex items-center gap-1">
          <Button size="sm" onClick={onRetry}>
            retry
          </Button>
          <Button size="sm" shortcut={downloadKey} onClick={onDownload}>
            download
          </Button>
        </span>
      </div>
    );
  }

  if (kind === "other" || kind === "too-large") {
    return (
      <div className="flex size-full items-center justify-center p-3">
        <div className="flex max-w-full flex-col items-start gap-2 rounded-md border border-border bg-surface-raised p-4">
          {kind === "too-large" ? <span className="text-12 text-text-muted">too large to preview</span> : null}
          <span className="max-w-full truncate text-text" title={file.filename}>
            {file.filename}
          </span>
          <span className="text-12 text-text-muted">
            {file.mimeType || "unknown type"} · {formatSize(file.size)}
          </span>
          <Button size="sm" shortcut={downloadKey} onClick={onDownload}>
            download
          </Button>
        </div>
      </div>
    );
  }

  const status =
    source.state === "loading" || decoding ? (
      <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-12 text-text-muted tabular-nums">
        loading{source.state === "loading" && source.progress !== null ? ` ${percent(source.progress)}` : ""}
      </p>
    ) : null;

  if (kind === "text") {
    if (source.state !== "ready") return status;
    return (
      <div className="size-full overflow-auto p-3">
        {source.text ? (
          <pre className="font-mono text-13 leading-prose whitespace-pre-wrap break-words text-text">{source.text}</pre>
        ) : (
          <p className="text-12 text-text-muted">empty file</p>
        )}
        {source.truncated ? (
          <p className="pt-3 text-12 text-text-muted">
            first {formatSize(TEXT_MAX_BYTES)} of {formatSize(file.size)}, download for the rest
          </p>
        ) : null}
      </div>
    );
  }

  if (kind === "pdf") {
    if (source.state !== "ready" || !source.url) return status;
    return <iframe src={source.url} title={file.filename} className="size-full border-0" />;
  }

  const url = source.state === "ready" ? source.url : null;
  return (
    <>
      {url ? (
        <div className={cn("flex size-full", actual ? "overflow-auto" : "overflow-hidden p-3")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- attachment bytes from our own route */}
          <img
            src={url}
            alt={file.filename}
            onLoad={() => onImage("ready")}
            onError={() => onImage("error")}
            className={cn("m-auto", actual ? "max-w-none" : "max-h-full max-w-full object-contain")}
          />
        </div>
      ) : null}
      {status}
    </>
  );
}
