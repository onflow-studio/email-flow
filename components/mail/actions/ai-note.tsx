"use client";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { useThreadActions } from "./actions";

const LINK =
  "underline decoration-info/40 underline-offset-2 transition-colors duration-80 ease-snap hover:decoration-info focus-visible:decoration-info outline-none";

const NAMES = { inbox: "inbox", news: "news", paper_trail: "paper trail", triage: "triage", out: "out" } as const;

/** A right-aligned `--info` note above the thread when the machine made a call worth a second look. */
export function AiNote({ thread }: { thread: ThreadDetail }) {
  const { runSender } = useThreadActions();

  if (thread.aiLetIn) {
    return (
      <div className="flex flex-col items-end gap-1 self-end text-right text-info">
        <p>{">>"} new sender, let in by AI</p>
        <p className="flex items-center gap-3 text-12">
          {/* Confirming makes it the user's own let-in, so the note stops showing for this sender. */}
          <button type="button" onClick={() => void runSender({ type: "letIn" }, thread.id)} className={LINK}>
            ✓ ok
          </button>
          <button type="button" onClick={() => void runSender({ type: "undoAiAllow" }, thread.id)} className={LINK}>
            undo
          </button>
        </p>
      </div>
    );
  }

  if (thread.bucketSuggested && thread.bucketSource === "ai") {
    const pct = thread.bucketConfidence === null ? "" : `, ${Math.round(thread.bucketConfidence * 100)}% sure`;
    return (
      <p className="self-end text-right text-info">
        {">>"} suggested {NAMES[thread.bucket]}
        {pct}. move with 1 2 3
      </p>
    );
  }

  return null;
}
