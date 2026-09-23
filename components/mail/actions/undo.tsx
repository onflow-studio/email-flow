"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { undo } from "@/app/(mail)/thread-actions";
import { Button } from "@/components/ui/button";
import { Countdown, dismissToast, showToast, ToastCard, Toaster, type ToastType } from "@/components/ui/toast";

import { useShortcut } from "../keys/keymap";

type UndoContextValue = {
  /** Show a result line; with a token it becomes an undo toast and the next thing `z` undoes. */
  report: (message: string, token?: string | null) => void;
  /** A line with a type and no undo: errors, warnings. */
  notify: (message: string, type: ToastType) => void;
  undoLast: () => void;
  undoToken: (token: string) => void;
  /** The token `z` undoes; only its toast shows the `z` segment. */
  lastToken: string | null;
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
const STACK_LIMIT = 50;

/**
 * Lives in the mail layout so the toasts and the undo stack survive
 * navigation. The stack is per tab: `z` only undoes what you did here.
 */
export function UndoProvider({ children }: { children: React.ReactNode }) {
  const stack = useRef<string[]>([]);
  const [lastToken, setLastToken] = useState<string | null>(null);

  const setStack = useCallback((next: string[]) => {
    stack.current = next;
    setLastToken(next.at(-1) ?? null);
  }, []);

  const notify = useCallback((message: string, type: ToastType) => {
    showToast(() => <ToastCard type={type} message={message} />, { duration: VISIBLE_MS });
  }, []);

  const report = useCallback(
    (message: string, token: string | null = null) => {
      if (!token) return notify(message, "default");
      setStack([...stack.current.slice(-(STACK_LIMIT - 1)), token]);
      showToast(() => <UndoToast message={message} token={token} />, { id: token, duration: UNDO_MS });
    },
    [notify, setStack],
  );

  const undoToken = useCallback(
    (token: string) => {
      setStack(stack.current.filter((t) => t !== token));
      dismissToast(token);
      undo(token)
        .then((r) =>
          r.unsubscribed
            ? notify("kept in, unsubscribe already sent", "warning")
            : r.count
              ? notify("undone", "success")
              : notify("nothing to undo", "warning"),
        )
        .catch(() => notify("undo failed, retry", "error"));
    },
    [notify, setStack],
  );

  const undoLast = useCallback(() => {
    const token = stack.current.at(-1);
    if (token) undoToken(token);
    else notify("nothing to undo", "warning");
  }, [undoToken, notify]);

  const value = useMemo(
    () => ({ report, notify, undoLast, undoToken, lastToken }),
    [report, notify, undoLast, undoToken, lastToken],
  );

  return (
    <UndoContext.Provider value={value}>
      {children}
      <Toaster />
    </UndoContext.Provider>
  );
}

function UndoToast({ message, token }: { message: string; token: string }) {
  const { undoToken, lastToken } = useUndo();
  const undoKey = useShortcut("undo");
  return (
    <ToastCard message={message}>
      <Button variant="secondary" size="sm" shortcut={token === lastToken ? undoKey : undefined} onClick={() => undoToken(token)}>
        undo
      </Button>
      <Countdown ms={UNDO_MS} />
    </ToastCard>
  );
}
