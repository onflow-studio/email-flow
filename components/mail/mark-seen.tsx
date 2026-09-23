"use client";

import { useEffect, useState } from "react";

import { markSeen } from "@/app/(mail)/thread-actions";

import { useAutoOpened, useMailSelection } from "./selection";

/** How long an auto-opened thread must stay on screen before it counts as read. */
const AUTO_READ_MS = 2000;

/**
 * Opening a thread marks it seen and mirrors read state to Gmail. A thread
 * opened for you on entering a view waits until you interact with it or it
 * has been on screen for two seconds; moving on sooner leaves it unread.
 */
export function MarkSeen({ threadId }: { threadId: string }) {
  const sel = useMailSelection();
  const { isAutoOpened, clearAutoOpened } = useAutoOpened();
  const [auto] = useState(() => isAutoOpened(threadId));
  const [done, setDone] = useState(false);
  const interacted = sel.pane === "reading";

  useEffect(() => {
    if (done) return;
    const mark = () => {
      setDone(true);
      clearAutoOpened();
      markSeen(threadId).catch(() => {});
    };
    if (!auto || interacted) {
      mark();
      return;
    }
    const timer = setTimeout(mark, AUTO_READ_MS);
    // Scrolling the thread is reading it, even with the keyboard still on the list.
    const pane = document.querySelector('[data-pane="reading"]');
    pane?.addEventListener("wheel", mark, { once: true, passive: true });
    return () => {
      clearTimeout(timer);
      pane?.removeEventListener("wheel", mark);
    };
  }, [threadId, auto, interacted, done, clearAutoOpened]);

  return null;
}
