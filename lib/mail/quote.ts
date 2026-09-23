// Quoted history under a reply: found so the reading pane can fold it into one line.
// Only trailing quotes fold; a quote with the sender's own text after it (an inline reply) stays.

export const QUOTE_ATTR = "data-quote";

const ATTRIBUTION = /^\s*(on|el|le|am|il|em)\b.{0,300}:\s*$/i;
// Outlook's header block: `From:` in the languages this mailbox sees.
const OUTLOOK_FROM = /^\s*(from|de|von|da|van)\s*:/i;

/** Splits a plain-text body at its trailing `>` quote, taking the attribution line with it. */
export function splitTextQuote(text: string): { body: string; quote: string | null } {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  while (start > 0 && (lines[start - 1].startsWith(">") || (!lines[start - 1].trim() && start < end))) start--;
  while (start < end && !lines[start].trim()) start++;
  if (start === end || !lines[start].startsWith(">")) return { body: text, quote: null };
  let cut = start;
  let prev = cut - 1;
  while (prev >= 0 && !lines[prev].trim()) prev--;
  if (prev >= 0 && ATTRIBUTION.test(lines[prev])) cut = prev;
  const body = lines.slice(0, cut).join("\n").trimEnd();
  if (!body) return { body: text, quote: null };
  return { body, quote: lines.slice(cut).join("\n") };
}

// The document lives in an iframe, so `instanceof Element` (this window's Element) would be false.
const isElement = (n: Node): n is Element => n.nodeType === 1;

function textOf(node: Node | null) {
  return (node?.textContent ?? "").trim();
}

/** Every node from `start` to the end of `root`, in document order, as the top-most elements that cover them. */
function tail(start: Element, root: Element): Node[] {
  const nodes: Node[] = [start];
  for (let el: Element | null = start; el && el !== root; el = el.parentElement) {
    for (let sib = el.nextSibling; sib; sib = sib.nextSibling) nodes.push(sib);
  }
  return nodes;
}

/** How a quote begins: a reply quote folds only when nothing of the sender's follows it; Outlook's header block always trails. */
function quoteKind(el: Element): "reply" | "outlook" | null {
  const tag = el.tagName.toLowerCase();
  if (el.classList.contains("gmail_quote")) return el.querySelector("blockquote") ? "reply" : null;
  if (tag === "blockquote" || el.classList.contains("yahoo_quoted") || el.classList.contains("moz-cite-prefix")) return "reply";
  if (tag === "hr") return OUTLOOK_FROM.test(textOf(el.nextElementSibling)) ? "outlook" : null;
  const style = el.getAttribute("style") ?? "";
  return /border-top\s*:\s*solid/i.test(style) && OUTLOOK_FROM.test(textOf(el)) ? "outlook" : null;
}

/** Whether anything readable is left outside the marked quote. */
function hasVisible(body: HTMLElement) {
  const outside = (n: Node) => !(isElement(n) ? n : n.parentElement)?.closest(`[${QUOTE_ATTR}]`);
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim() && outside(n)) return true;
  return Array.from(body.querySelectorAll("img")).some(outside);
}

function mark(doc: Document, nodes: Node[]) {
  for (const n of nodes) {
    if (isElement(n)) n.setAttribute(QUOTE_ATTR, "");
    else if (n.textContent?.trim()) {
      const wrap = doc.createElement("span");
      wrap.setAttribute(QUOTE_ATTR, "");
      n.parentNode?.insertBefore(wrap, n);
      wrap.appendChild(n);
    }
  }
}

/**
 * Marks the trailing quote in an email document with `data-quote` so CSS can hide it.
 * Returns whether one was found. Idempotent: an already marked document is left alone.
 */
export function markQuote(doc: Document): boolean {
  const body = doc.body;
  if (!body) return false;
  if (body.querySelector(`[${QUOTE_ATTR}]`)) return true;
  for (const el of Array.from(body.querySelectorAll("*"))) {
    const kind = quoteKind(el);
    if (!kind) continue;
    let start = el;
    // Apple Mail and Thunderbird put the `On …, X wrote:` line just before the blockquote.
    const before = el.previousElementSibling;
    if (el.tagName.toLowerCase() === "blockquote" && before && ATTRIBUTION.test(textOf(before))) start = before;
    const nodes = tail(start, body);
    // A signature after the quote (`-- ` or Gmail's signature block) stays visible; the fold ends before it.
    const sig = nodes.findIndex((n, i) => i > 0 && (textOf(n).startsWith("--") || (isElement(n) && /signature/.test(n.className))));
    if (sig > 0) nodes.splice(sig);
    // The sender's own text after a reply quote means an inline reply: leave it all visible.
    const after = nodes.filter((n) => n !== start && n !== el && !(isElement(n) && n.tagName.toLowerCase() === "blockquote"));
    if (kind === "reply" && after.some((n) => textOf(n))) continue;
    mark(doc, nodes);
    if (hasVisible(body)) return true;
    body.querySelectorAll(`[${QUOTE_ATTR}]`).forEach((n) => n.removeAttribute(QUOTE_ATTR));
    return false;
  }
  return false;
}
