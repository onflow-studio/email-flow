"use client";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";

import { CommandKbd } from "@/components/mail/keys/keymap";
import { cn } from "@/lib/utils";

import { useThreadActions } from "./actions";

const LINK =
  "underline decoration-info/40 underline-offset-2 transition-colors duration-80 ease-snap hover:decoration-info focus-visible:decoration-info outline-none";

type Movable = "inbox" | "news" | "paper_trail";
const MOVABLE: Movable[] = ["inbox", "news", "paper_trail"];

const NAMES = { inbox: "inbox", news: "news", paper_trail: "paper trail", triage: "triage", out: "out" } as const;

/** A right-aligned `--info` note above the thread when the machine made a call worth a second look. */
export function AiNote({ thread }: { thread: ThreadDetail }) {
  const { run, runSender } = useThreadActions();

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
    const others = MOVABLE.filter((b) => b !== thread.bucket);
    return (
      <div className="flex flex-col items-end gap-1 self-end text-right text-info">
        <p>
          {">>"} AI put this in {NAMES[thread.bucket]}
          {pct}
        </p>
        <p className="flex items-center gap-3 text-12">
          {/* Ok keeps the bucket as the user's own; the others move it and teach the classifier. */}
          <button type="button" onClick={() => void run({ type: "move", bucket: thread.bucket as Movable }, [thread.id])} className={LINK}>
            ✓ ok
          </button>
          {others.map((b) => (
            <button key={b} type="button" onClick={() => void run({ type: "move", bucket: b }, [thread.id])} className={cn(LINK, "flex items-center gap-1")}>
              {NAMES[b]}
              <CommandKbd id={`move.${b}`} />
            </button>
          ))}
        </p>
      </div>
    );
  }

  return null;
}
