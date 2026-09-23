"use client";

const pad = (n: number) => n.toString().padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `14:05` today, `sep 21` this year, `2025-03-04` before. */
export function shortTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `sep 21 14:05`, or `2025-03-04 14:05` outside this year. */
export function fullTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const day =
    d.getFullYear() === now.getFullYear()
      ? `${MONTHS[d.getMonth()]} ${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function agoTime(iso: string, now = new Date()) {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Formats in the viewer's timezone; the server render may differ by zone. */
export function Time({
  iso,
  format = "short",
  className,
}: {
  iso: string;
  format?: "short" | "full" | "ago";
  className?: string;
}) {
  const fn = format === "full" ? fullTime : format === "ago" ? agoTime : shortTime;
  return (
    <time dateTime={iso} title={fullTime(iso)} className={className} suppressHydrationWarning>
      {fn(iso)}
    </time>
  );
}
