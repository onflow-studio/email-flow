import { MATCH_END, MATCH_START } from "@/lib/search/query";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Drops accents one UTF-16 unit at a time, so indexes still line up with `s`. */
const fold = (s: string) =>
  Array.from({ length: s.length }, (_, i) => s[i].normalize("NFD").replace(/\p{M}/gu, "")[0] ?? s[i]).join("");

/** Marks word-prefix matches of the query words in `--accent`, accents ignored as search does. */
export function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map((w) => escapeRegExp(fold(w))).join("|")})`, "giu");
  const parts: string[] = [];
  let last = 0;
  for (const m of fold(text).matchAll(pattern)) {
    parts.push(text.slice(last, m.index), text.slice(m.index, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Renders a ts_headline fragment, its marked matches in `--accent`. */
export function Snippet({ text }: { text: string }) {
  const matchAt = text.indexOf(MATCH_START);
  const start = Math.max(0, matchAt - 32);
  const excerpt = start > 0 ? `…${text.slice(start)}` : text;
  const parts = excerpt.split(new RegExp(`${MATCH_START}|${MATCH_END}`));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
