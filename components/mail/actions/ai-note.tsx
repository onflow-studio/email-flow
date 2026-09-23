"use client";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { useThreadActions } from "./actions";

const NAMES = { inbox: "inbox", news: "news", paper_trail: "paper trail", triage: "triage", out: "out" } as const;

/** One `--info` line above the thread when the machine made a call worth a second look. */
export function AiNote({ thread }: { thread: ThreadDetail }) {
  const { runSender } = useThreadActions();

  if (thread.aiLetIn) {
    return (
      <p className="text-info">
        {">>"} new sender, let in by AI.{" "}
        <button
          type="button"
          onClick={() => void runSender({ type: "undoAiAllow" }, thread.id)}
          className="underline decoration-info/40 underline-offset-2 transition-colors duration-80 ease-snap hover:decoration-info"
        >
          undo?
        </button>
      </p>
    );
  }

  if (thread.bucketSuggested && thread.bucketSource === "ai") {
    const pct = thread.bucketConfidence === null ? "" : `, ${Math.round(thread.bucketConfidence * 100)}% sure`;
    return (
      <p className="text-info">
        {">>"} suggested {NAMES[thread.bucket]}
        {pct}. move with 1 2 3
      </p>
    );
  }

  return null;
}
