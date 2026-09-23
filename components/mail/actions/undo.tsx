"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { undo } from "@/app/(mail)/thread-actions";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; token: string | null; leaving: boolean };

type UndoContextValue = {
  /** Show a result line; with a token it becomes the next thing `u` undoes. */
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
const FADE_MS = 150;
const STACK_LIMIT = 50;

/**
 * Lives in the mail layout so the toast and the undo stack survive
 * navigation. The stack is per tab: `u` only undoes what you did here.
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
        .then((r) => report(r.count ? "undone" : "nothing to undo"))
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
  useEffect(() => {
    if (toastId === undefined) return;
    const fade = setTimeout(() => setToast((t) => (t?.id === toastId ? { ...t, leaving: true } : t)), VISIBLE_MS);
    const clear = setTimeout(() => setToast((t) => (t?.id === toastId ? null : t)), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [toastId]);

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
              undo <kbd className="text-11 opacity-60">u</kbd>
            </button>
          ) : null}
        </div>
      ) : null}
    </UndoContext.Provider>
  );
}
