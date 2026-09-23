import { MATCH_END, MATCH_START } from "@/lib/search/query";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks word-prefix matches of the query words in `--accent`. */
export function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join("|")})`, "giu");
  const parts = text.split(pattern);
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
  const parts = text.split(new RegExp(`${MATCH_START}|${MATCH_END}`));
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
