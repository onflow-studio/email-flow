import type { Digest, DigestBucket } from "@/lib/db/schema";

const BUCKET_LABELS: Record<DigestBucket, string> = {
  inbox: "inbox",
  news: "news",
  paper_trail: "paper trail",
  receipts: "receipts",
  triage: "triage",
};

/** Today's briefing at the top of the digest view; the threads it talks about are the sections below. */
export function DigestSummary({ digest }: { digest: Digest }) {
  const { content } = digest;
  const lines = digest.summary.split("\n").filter(Boolean);
  return (
    <section aria-label="daily digest" className="flex flex-col gap-2 border-b border-border px-3 py-2">
      <header className="flex items-center justify-between text-11 text-text-muted">
        <span>today</span>
        <span className="tabular-nums">{digest.day}</span>
      </header>
      {lines.length ? (
        <ul className="flex flex-col gap-1 leading-list text-text">
          {lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : null}
      <p className="text-11 text-text-muted tabular-nums">
        last 24 hours: {(Object.keys(BUCKET_LABELS) as DigestBucket[]).map((b) => `${BUCKET_LABELS[b]} ${content.arrivals[b]}`).join(" · ")}
      </p>
    </section>
  );
}
