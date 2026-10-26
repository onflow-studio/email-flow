import Link from "next/link";

import type { Digest, DigestBucket } from "@/lib/db/schema";

import { Time } from "./time";
import { mailHref } from "./views";

const BUCKET_LABELS: Record<DigestBucket, string> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper trail",
  receipts: "receipts",
  triage: "triage",
};

/** The day's digest at the top of the digest view; an older one is marked with its date. */
export function DigestSummary({ digest, today }: { digest: Digest; today: boolean }) {
  const { content } = digest;
  const lines = digest.summary.split("\n").filter(Boolean);
  const item = "flex h-touch min-w-0 items-center gap-2 rounded-sm px-1 transition-colors duration-80 ease-snap hover:bg-surface-raised/50 focus-visible:bg-surface-raised md:h-row";
  return (
    <section aria-label="daily digest" className="flex flex-col gap-2 border-b border-border px-3 py-2">
      <header className="flex items-center justify-between text-11 text-text-muted">
        <span>daily digest</span>
        <span className="tabular-nums">{today ? digest.day : `from ${digest.day}`}</span>
      </header>
      {lines.length ? (
        <ul className="flex flex-col gap-1 leading-list text-text">
          {lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : null}
      <p className="text-11 text-text-muted tabular-nums">
        last 24 hours: {(Object.keys(BUCKET_LABELS) as DigestBucket[]).map((b) => `${BUCKET_LABELS[b]} ${content.arrivals[b]}`).join(" · ")}
      </p>
      <p className="text-11 text-text-muted tabular-nums">
        needs reply {content.needsReply.total} · deadlines {content.deadlines.total} · triage waiting {content.triage}
      </p>
      {content.deadlines.items.length ? (
        <ul aria-label="deadlines">
          {content.deadlines.items.map((t) => (
            <li key={t.threadId}>
              <Link href={mailHref("digest", { threadId: t.threadId })} scroll={false} className={item}>
                <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                <span className="shrink-0 text-11 text-text-dim">{t.account}</span>
                <span className="shrink-0 rounded-sm bg-surface-raised px-1 text-11 whitespace-nowrap text-warning">
                  {t.overdue ? "overdue" : <>due <Time iso={t.deadlineAt} format="full" /></>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {content.needsReply.items.length ? (
        <ul aria-label="needs reply">
          {content.needsReply.items.map((t) => (
            <li key={t.threadId}>
              <Link href={mailHref("digest", { threadId: t.threadId })} scroll={false} className={item}>
                <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                <span className="shrink-0 text-11 text-text-dim">{t.account}</span>
                <span className="shrink-0 rounded-sm bg-signal/15 px-1 text-11 whitespace-nowrap text-signal tabular-nums">reply {t.days}d</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
