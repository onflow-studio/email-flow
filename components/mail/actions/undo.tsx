"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { undo } from "@/app/(mail)/thread-actions";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; token: string | null; leaving: boolean };

type UndoContextValue = {
  /** Show a result line; with a token it becomes the next thing `z` undoes. */
  report: (message: string, token?: string | null) => void;
  undoLast: () => void;
  undoToken: (token: string) => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export function useUndo() {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndo must be used inside <UndoProvider>");
  return ctx;
}

const VISIBLE_MS = 4000;
// An undoable toast stays long enough to change your mind, with the seconds left on it.
const UNDO_MS = 10000;
const FADE_MS = 150;
const STACK_LIMIT = 50;

/**
 * Lives in the mail layout so the toast and the undo stack survive
 * navigation. The stack is per tab: `z` only undoes what you did here.
 */
export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const stack = useRef<string[]>([]);
  const nextId = useRef(0);

  const report = useCallback((message: string, token: string | null = null) => {
    if (token) stack.current = [...stack.current.slice(-(STACK_LIMIT - 1)), token];
    setToast({ id: ++nextId.current, message, token, leaving: false });
  }, []);

  const undoToken = useCallback(
    (token: string) => {
      stack.current = stack.current.filter((t) => t !== token);
      undo(token)
        .then((r) => report(r.unsubscribed ? "kept in, unsubscribe already sent" : r.count ? "undone" : "nothing to undo"))
        .catch(() => report("undo failed, retry"));
    },
    [report],
  );

  const undoLast = useCallback(() => {
    const token = stack.current.at(-1);
    if (token) undoToken(token);
    else report("nothing to undo");
  }, [undoToken, report]);

  const toastId = toast?.id;
  const undoable = !!toast?.token;
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (toastId === undefined) return;
    const visible = undoable ? UNDO_MS : VISIBLE_MS;
    const end = Date.now() + visible;
    const tick = () => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const countdown = undoable ? setInterval(tick, 250) : undefined;
    const fade = setTimeout(() => setToast((t) => (t?.id === toastId ? { ...t, leaving: true } : t)), visible);
    const clear = setTimeout(() => setToast((t) => (t?.id === toastId ? null : t)), visible + FADE_MS);
    return () => {
      clearInterval(countdown);
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [toastId, undoable]);

  const value = useMemo(() => ({ report, undoLast, undoToken }), [report, undoLast, undoToken]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "fixed right-3 bottom-8 z-40 flex h-row items-center gap-4 rounded-sm border border-border bg-surface-raised px-3 transition-opacity duration-150 ease-snap",
            toast.leaving && "opacity-0",
          )}
        >
          <span>{toast.message}</span>
          {toast.token ? (
            <button
              type="button"
              onClick={() => undoToken(toast.token!)}
              className="flex items-center gap-2 text-text-muted transition-colors duration-80 ease-snap hover:text-text"
            >
              undo <Kbd keys="z" />
            </button>
          ) : null}
          {toast.token ? <span className="w-6 text-right text-11 text-text-muted">{left}s</span> : null}
        </div>
      ) : null}
    </UndoContext.Provider>
  );
}
