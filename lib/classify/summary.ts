import type { Bucket } from "@/lib/db/schema";

export const SUMMARY_LIMIT = 200;

// News keeps the snippet and out is never shown, so neither is worth a summary call of its own.
export function wantsSummary(bucket: Bucket) {
  return bucket !== "news" && bucket !== "out";
}

// Never throws: a bad summary should not cost the classification. Null means show the snippet.
export function parseSummary(summary: string | null | undefined): string | null {
  const line = (summary ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“«](.*)["'”»]$/u, "$1")
    .trim();
  if (!line) return null;
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : line;
}
