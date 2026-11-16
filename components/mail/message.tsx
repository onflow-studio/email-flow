"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import type { Address } from "@/lib/db/schema";
import { splitTextQuote } from "@/lib/mail/quote";
import { cn } from "@/lib/utils";

import { AttachmentList } from "./attachments/attachment-list";
import { EmailFrame } from "./email-frame";
import { AddressList, PersonName } from "./person-card";
import { QuoteFold } from "./quote-fold";
import { fullTime, Time } from "./time";

export type MessageItem = ThreadDetail["messages"][number];

export function displayName(m: MessageItem) {
  return m.isInbound ? m.fromName || m.fromEmail : "me";
}

/** Header line, recipients, body and attachments of one message. */
export function MessageContent({ message: m, quoteLabel = null }: { message: MessageItem; quoteLabel?: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col">
        <div className="group/header flex min-w-0 items-baseline gap-2">
          {m.isInbound ? (
            <PersonName address={{ name: m.fromName ?? "", email: m.fromEmail }} className="font-medium text-text" />
          ) : (
            <span className="min-w-0 truncate font-medium text-text">{displayName(m)}</span>
          )}
          {m.fromName || !m.isInbound ? (
            <span className="hidden min-w-0 shrink-2 truncate text-12 text-text-muted md:inline">{m.fromEmail}</span>
          ) : null}
          <CopyButton text={() => ownText(m)} label="copy text" className="md:group-hover/header:opacity-100" />
          <Time iso={m.date} format="full" className="shrink-0 text-12 text-text-muted" />
        </div>
        <span className="truncate text-11 text-text-muted">
          to <AddressList list={m.to} />
          {m.cc.length ? (
            <>
              , cc <AddressList list={m.cc} />
            </>
          ) : null}
        </span>
      </div>

      {m.htmlSanitized ? (
        <EmailFrame html={m.htmlSanitized} imagesAllowed={m.imagesAllowed} senderId={m.senderId} quoteLabel={quoteLabel} />
      ) : (
        <TextBody text={m.text ?? ""} quoteLabel={quoteLabel} />
      )}

      <AttachmentList message={m} />
    </div>
  );
}

/** A message's own text, without the quoted history. */
function ownText(m: MessageItem) {
  return splitTextQuote(m.text ?? "").body.trim();
}

/** The whole thread as plain text, oldest first: the subject, then each message's header line, recipients and own text. */
export function threadText(subject: string, messages: MessageItem[]) {
  const parts = messages.map((m) => {
    const from = m.isInbound ? (m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail) : `me <${m.fromEmail}>`;
    const to = `to ${formatAddresses(m.to)}${m.cc.length ? `, cc ${formatAddresses(m.cc)}` : ""}`;
    return `${from}, ${fullTime(m.date)}\n${to}\n\n${ownText(m) || (m.snippet ?? "")}`;
  });
  return [subject, ...parts].join("\n\n---\n\n");
}

/**
 * Copies `text()` to the clipboard, with a check for 1.5s after. Hidden on desktop until its
 * `className` reveals it (a `group-hover` on what it belongs to) or it has keyboard focus.
 */
export function CopyButton({ text, label, className }: { text: () => string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => {
    navigator.clipboard.writeText(text()).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  const Icon = state === "copied" ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      title={state === "failed" ? "copy failed" : state === "copied" ? "copied" : label}
      aria-label={label}
      className={cn(
        "ml-auto flex size-4 shrink-0 items-center justify-center self-center rounded-sm outline-none transition-[color,opacity] duration-80 ease-snap focus-visible:text-accent focus-visible:opacity-100 hover:text-text",
        state === "idle" ? "text-text-muted md:opacity-0" : state === "copied" ? "text-success" : "text-danger",
        className,
      )}
    >
      <Icon aria-hidden className="size-3" strokeWidth={1.5} />
    </button>
  );
}

function TextBody({ text, quoteLabel }: { text: string; quoteLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const { body, quote } = quoteLabel === null ? { body: text, quote: null } : splitTextQuote(text);
  return (
    <div className="flex flex-col gap-2">
      <div className="leading-prose whitespace-pre-wrap text-text">{quote && !open ? body : text}</div>
      {quote && quoteLabel !== null ? <QuoteFold label={quoteLabel} open={open} onToggle={() => setOpen(!open)} /> : null}
    </div>
  );
}

function formatAddresses(list: Address[]) {
  if (!list.length) return "undisclosed";
  return list.map((a) => a.name || a.email).join(", ");
}
