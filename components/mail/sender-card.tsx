"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import type { SenderChoice } from "@/lib/classify/screener";
import { cn } from "@/lib/utils";

import { useThreadActions } from "./actions/actions";
import { AccountSquare } from "./account-square";
import { Time } from "./time";

type Card = NonNullable<ThreadDetail["sender"]>;

const LET_IN: { choice: SenderChoice; label: string }[] = [
  { choice: "inbox", label: "inbox" },
  { choice: "news", label: "news" },
  { choice: "paper_trail", label: "paper trail" },
  { choice: "receipts", label: "receipts" },
];

const KEEP_OUT: { choice: SenderChoice; label: string }[] = [
  { choice: "out_not_now", label: "not now" },
  { choice: "out_spam", label: "spam" },
];

/** The card's one-word standing for a sender: its choice, or how it got in without one. */
function standing(card: Card) {
  if (card.choice === "out_spam") return "kept out, spam";
  if (card.choice === "out_not_now") return "kept out";
  if (card.choice) return [...LET_IN, ...KEEP_OUT].find((c) => c.choice === card.choice)!.label;
  if (card.decision === "allowed") return card.decidedBy === "ai" ? "let in by AI" : "let in";
  return "undecided";
}

/**
 * Who the thread's sender is to you: the accounts they write to, threads, last mail and the
 * screener choice, which can be changed here with undo. Collapsed to one line by default.
 */
export function SenderCard({ thread, card }: { thread: ThreadDetail; card: Card }) {
  const { runSender } = useThreadActions();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const pick = (choice: SenderChoice) => {
    if (choice !== card.choice) void runSender({ type: "decideSender", choice }, thread.id);
  };

  return (
    <section aria-label="sender" className="border-y border-border text-12 text-text-muted">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-touch w-full min-w-0 items-center gap-2 text-left transition-colors duration-80 ease-snap hover:text-text focus-visible:text-text md:h-row"
      >
        <span className="flex w-4 shrink-0">
          <Chevron aria-hidden className="size-3" strokeWidth={1.5} />
        </span>
        <span className="min-w-0 truncate text-text">{card.name || card.email}</span>
        <span className="shrink-0 tabular-nums">
          {card.threadCount} {card.threadCount === 1 ? "thread" : "threads"}
        </span>
        {card.lastSeenAt ? (
          <span className="hidden shrink-0 md:inline">
            last <Time iso={card.lastSeenAt} format="ago" />
          </span>
        ) : null}
        <span className="ml-auto shrink-0">{standing(card)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 pb-3 pl-6">
          <div className="flex flex-col gap-1">
            <span className="truncate">{card.email}</span>
            {card.lastSeenAt ? (
              <span>
                last mail <Time iso={card.lastSeenAt} format="full" />
              </span>
            ) : null}
          </div>
          {card.accounts.length ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>writes to</span>
              {card.accounts.map((a) => (
                <span key={a.id} className="flex items-center gap-2">
                  <AccountSquare color={a.color} />
                  <span className="text-text">{a.label}</span>
                  <span className="tabular-nums">{a.seenCount}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div role="radiogroup" aria-label="their mail goes to" className="flex flex-wrap items-center gap-1">
            <span className="mr-1">always</span>
            {LET_IN.map((c) => (
              <Choice key={c.choice} label={c.label} on={card.choice === c.choice} onPick={() => pick(c.choice)} />
            ))}
            <span className="mr-1 ml-3">keep out</span>
            {KEEP_OUT.map((c) => (
              <Choice key={c.choice} label={c.label} on={card.choice === c.choice} danger={c.choice === "out_spam"} onPick={() => pick(c.choice)} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Choice({ label, on, danger, onPick }: { label: string; on: boolean; danger?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex h-touch items-center rounded-sm px-2 outline-1 outline-offset-0 outline-transparent transition-colors duration-80 ease-snap focus-visible:outline-accent md:h-6",
        on ? "bg-accent-dim text-text" : "hover:bg-surface-raised hover:text-text",
        !on && danger && "hover:text-danger focus-visible:text-danger",
      )}
    >
      {label}
    </button>
  );
}
