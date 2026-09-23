"use client";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { useThreadActions } from "./actions";

const LINK =
  "underline decoration-info/40 underline-offset-2 transition-colors duration-80 ease-snap hover:decoration-info focus-visible:decoration-info outline-none";

/** A right-aligned `--info` note above the thread when the AI let a new sender in; a doubtful bucket shows on the bucket badge instead. */
export function AiNote({ thread }: { thread: ThreadDetail }) {
  const { runSender } = useThreadActions();

  if (thread.aiLetIn) {
    return (
      <div className="flex flex-col items-end gap-1 self-end text-right text-info">
        <p>
          {">>"} {thread.aiAllowed > 1 ? `${thread.aiAllowed} new senders` : "new sender"}, let in by AI
          {thread.wroteIn ? ", you wrote in this thread" : null}
        </p>
        <p className="flex items-center gap-3 text-12">
          {/* Confirming makes it the user's own let-in, so the note stops showing for these senders. */}
          <button type="button" onClick={() => void runSender({ type: "confirmAiAllow" }, thread.id)} className={LINK}>
            ✓ ok
          </button>
          <button type="button" onClick={() => void runSender({ type: "undoAiAllow" }, thread.id)} className={LINK}>
            undo
          </button>
        </p>
      </div>
    );
  }

  return null;
}
