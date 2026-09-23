/**
 * Palette query syntax: free words plus `from:`, `account:`, `before:`,
 * `after:`. Quoted text is a phrase. Words match as prefixes so results
 * narrow while typing.
 */
/** Markers ts_headline wraps around matched words in snippets. */
export const MATCH_START = "\u27e6";
export const MATCH_END = "\u27e7";

export type ParsedQuery = {
  /** tsquery source for the `simple` config, or null when there are no words. */
  tsquery: string | null;
  /** Words and phrase words, lowercased, for highlighting. */
  words: string[];
  from: string[];
  account: string[];
  before: Date | null;
  after: Date | null;
};

const TOKEN = /(\w+):("[^"]*"?|\S+)|"([^"]*)"?|(\S+)/g;
const WORD = /[\p{L}\p{N}]+/gu;

const words = (text: string) => (text.toLowerCase().match(WORD) ?? []).slice(0, 12);

/** `2025`, `2025-03` or `2025-03-04`, as the start of that period in UTC. */
export function parseDate(value: string): Date | null {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseQuery(input: string): ParsedQuery {
  const parsed: ParsedQuery = { tsquery: null, words: [], from: [], account: [], before: null, after: null };
  const clauses: string[] = [];

  for (const [, key, rawValue, phrase, bare] of input.matchAll(TOKEN)) {
    const value = rawValue?.replace(/^"|"$/g, "").trim();
    if (key && value) {
      const k = key.toLowerCase();
      if (k === "from") {
        parsed.from.push(value.toLowerCase());
        continue;
      }
      if (k === "account") {
        parsed.account.push(value.toLowerCase());
        continue;
      }
      if (k === "before" || k === "after") {
        const date = parseDate(value);
        if (date) parsed[k] = date;
        continue;
      }
    }
    const text = phrase ?? bare ?? `${key}:${value ?? ""}`;
    const w = words(text);
    if (!w.length) continue;
    parsed.words.push(...w);
    // A phrase keeps word order; the last word is still a prefix.
    clauses.push(phrase !== undefined ? w.map((x, i) => (i === w.length - 1 ? `${x}:*` : x)).join(" <-> ") : w.map((x) => `${x}:*`).join(" & "));
  }

  parsed.tsquery = clauses.length ? clauses.join(" & ") : null;
  return parsed;
}

export function isEmptyQuery(q: ParsedQuery) {
  return !q.tsquery && !q.from.length && !q.account.length && !q.before && !q.after;
}
