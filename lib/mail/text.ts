import { decodeHTML } from "entities";
import { convert } from "html-to-text";

// Plain text for search and the classifier. Links and images dropped, layout flattened.
export function htmlToText(html: string): string {
  return normalizeText(
    convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
      ],
    }),
  );
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍⁠﻿͏­]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Prefer the sender's own text part; derive from HTML when it is missing or a stub.
export function extractText(plain: string | null, html: string | null): string | null {
  const text = plain ? normalizeText(plain) : "";
  if (text.length >= 20 || !html) return text || null;
  return htmlToText(html) || text || null;
}

// Gmail snippets arrive HTML-escaped.
export function decodeSnippet(snippet: string | null | undefined): string | null {
  return snippet ? decodeHTML(snippet).trim() || null : null;
}
