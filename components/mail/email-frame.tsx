"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { alwaysLoadImages } from "@/app/(mail)/thread-actions";
import { isPlainEmail } from "@/lib/mail/plain";
import { markQuote, QUOTE_ATTR } from "@/lib/mail/quote";
import { hasBlockedImages, restoreRemoteImages } from "@/lib/mail/remote";

import { cn } from "@/lib/utils";

import { QuoteFold } from "./quote-fold";

/**
 * Declares a dark scheme via meta or CSS `color-scheme`. A dark media query alone does not count:
 * senders like Google Calendar use it to lighten text only, leaving their white backgrounds.
 */
export function declaresDarkScheme(html: string) {
  return (
    /<meta[^>]+name=["']?color-scheme["']?[^>]*content=["'][^"']*dark/i.test(html) ||
    /<meta[^>]+content=["'][^"']*dark[^"']*["'][^>]*name=["']?color-scheme/i.test(html) ||
    /(^|[^-])color-scheme\s*:\s*[^;}"']*dark/i.test(html)
  );
}

export function hasRemoteImages(html: string) {
  return (
    hasBlockedImages(html) ||
    /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /background\s*=\s*["']?\s*(https?:)?\/\//i.test(html)
  );
}

const QUOTE_OPEN = "data-quote-open";

// DESIGN.md --text, --text-muted, --text-dim and --border: the iframe cannot read the app's CSS variables.
const TEXT = "#e6fbff";
const TEXT_MUTED = "#7fb2c2";
const TEXT_DIM = "#3f6674";
const BORDER = "#132631";

/**
 * Plain mail as native text: the app's colors, font, size and prose line height on a
 * transparent page, no frame. Bold is 600 as everywhere; links are text-colored and underlined.
 * The body is its own formatting context: with no padding, its children's margins would otherwise
 * escape it, and the frame, sized from the body, would cut the last line off.
 */
const PLAIN_CSS = `:root{color-scheme:dark}
html,body{background:transparent!important}
body{padding:0;color:${TEXT};font:13px/1.6 var(--app-font,ui-monospace,SFMono-Regular,Menlo,monospace)}
body{display:flow-root}body>:first-child{margin-top:0!important}body>:last-child{margin-bottom:0!important}
body *{color:inherit!important;background-color:transparent!important;font-family:inherit!important;font-size:inherit!important;line-height:inherit!important;border-color:${BORDER}!important}
body h1{font-size:20px!important}body h2{font-size:15px!important}
body h1,body h2,body h3,body b,body strong,body th{font-weight:600!important}
body a{text-decoration:underline!important;text-decoration-color:${TEXT_DIM}!important;text-underline-offset:2px}
body blockquote{margin:0!important;padding-left:12px!important;border-left:1px solid ${BORDER}!important;color:${TEXT_MUTED}!important}
body hr{border:0!important;border-top:1px solid ${BORDER}!important}`;

/** The app's font inside the frame: its @font-face rules and the computed family. */
function copyAppFont(doc: Document) {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule) || !/jetbrains/i.test(rule.style.getPropertyValue("font-family"))) continue;
      // Font urls are relative to the stylesheet; the frame document would resolve them against the page.
      const base = sheet.href ?? document.baseURI;
      faces.push(rule.cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (_, url: string) => `url("${new URL(url, base).href}")`));
    }
  }
  const style = doc.createElement("style");
  style.textContent = faces.join("\n");
  doc.head.appendChild(style);
  doc.documentElement.style.setProperty("--app-font", getComputedStyle(document.body).fontFamily);
}

// CSP does not govern navigation; a refresh would load a remote page in the frame.
const META_REFRESH = /<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi;

/**
 * Builds the iframe document. The CSP is the only thing standing between the
 * email and the network: no scripts, no remote styles or fonts, no forms, and
 * remote images only when explicitly allowed.
 */
export function buildEmailDocument(html: string, { allowImages, plain }: { allowImages: boolean; plain: boolean }) {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    // 'self' lets a plain email use the app's own font, copied in on load.
    `font-src data:${plain ? " 'self'" : ""}`,
    // 'self' serves inline cid: images through /api/attachments.
    `img-src 'self' data: cid:${allowImages ? " https: http:" : ""}`,
    "media-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  // Light emails get inverted with a hue rotation so brand colors keep their
  // hue; media is inverted back so photos look right. Plain emails are restyled instead.
  const invert = !plain && !declaresDarkScheme(html);
  // #edf0f5 lands near --surface after invert and hue rotation, so bare emails sit on the pane color.
  const invertCss = invert
    ? `html{background:#edf0f5;filter:invert(1) hue-rotate(180deg)}
img,picture,video,svg,[style*="background-image"],[background]{filter:invert(1) hue-rotate(180deg)}`
    : "";
  // Designed emails lay out at the width they were made for, then scale down to fit, instead of
  // squeezing their tables into a narrow pane. 576 plus the body's 12px padding on each side is 600.
  // Phone-width frames keep the email's own responsive layout.
  const layoutCss = plain ? "" : "@media (min-width:420px){body{min-width:576px}}";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>html,body{margin:0}html{overflow:hidden}body{padding:12px;overflow-wrap:break-word;font-family:system-ui,sans-serif}img{max-width:100%;height:auto}body:not([${QUOTE_OPEN}]) [${QUOTE_ATTR}]{display:none!important}${layoutCss}${invertCss}${plain ? PLAIN_CSS : ""}</style>
</head><body>${(allowImages ? restoreRemoteImages(html) : html).replace(META_REFRESH, "")}</body></html>`;
}

export function EmailFrame({
  html,
  imagesAllowed,
  senderId,
  quoteLabel = null,
}: {
  html: string;
  imagesAllowed: boolean;
  senderId: string | null;
  /** Fold the trailing quote under this label; null leaves the email whole. */
  quoteLabel?: string | null;
}) {
  const [loadImages, setLoadImages] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const allowImages = imagesAllowed || loadImages;
  const plain = useMemo(() => isPlainEmail(html), [html]);
  const invert = !plain && !declaresDarkScheme(html);
  const blocked = !allowImages && hasRemoteImages(html);

  const [hasQuote, setHasQuote] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const quoteOpenRef = useRef(quoteOpen);

  const observer = useRef<ResizeObserver | null>(null);
  // The document already observed, so a late onLoad after the mount check does not double-wire keys.
  const wired = useRef<Document | null>(null);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    // Fixed-width newsletters wider than the pane are scaled down to fit instead of scrolling
    // sideways inside the frame; the pane then scrolls as one.
    // Measure at full size every time: a scaled body never reports less than the frame width.
    if (doc.body) {
      doc.body.style.zoom = "";
      const fit = doc.documentElement.clientWidth / doc.documentElement.scrollWidth;
      doc.body.style.zoom = fit < 0.99 ? String(Math.round(fit * 1000) / 1000) : "";
    }
    // The body, not the root: the root never reports less than the frame, so the frame could not shrink
    // when the quote folds again.
    const content = doc.body?.scrollHeight ?? doc.documentElement.scrollHeight;
    // A framed email is border-box with a 1px border on each side.
    setHeight(content + (plain ? 0 : 2));
  }, [plain]);

  // Same-origin sandbox (no scripts) lets the parent size the frame to its
  // content and forward keys, so j/k keep working after a click in the email.
  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    if (plain) copyAppFont(doc);
    if (quoteLabel !== null) {
      setHasQuote(markQuote(doc));
      doc.body.toggleAttribute(QUOTE_OPEN, quoteOpenRef.current);
    }
    measure();
    if (wired.current === doc) return;
    wired.current = doc;
    observer.current?.disconnect();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(doc.body);
    doc.addEventListener("load", measure, true);
    doc.addEventListener("keydown", (e) => {
      const forwarded = new KeyboardEvent("keydown", {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        cancelable: true,
      });
      window.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) e.preventDefault();
    });
  }, [measure, quoteLabel, plain]);

  const toggleQuote = () => {
    const open = !quoteOpen;
    quoteOpenRef.current = open;
    setQuoteOpen(open);
    ref.current?.contentDocument?.body?.toggleAttribute(QUOTE_OPEN, open);
    measure();
  };

  // A server-rendered srcDoc can finish loading before React attaches onLoad.
  useEffect(() => {
    if (ref.current?.contentDocument?.readyState === "complete") onLoad();
  }, [onLoad]);

  useEffect(() => () => observer.current?.disconnect(), []);

  return (
    <div className="flex flex-col gap-2">
      {blocked ? (
        <p className="flex items-center gap-2 text-11 text-text-muted">
          <span>remote images blocked</span>
          <button
            type="button"
            onClick={() => setLoadImages(true)}
            className="text-text-muted underline decoration-text-dim underline-offset-2 transition-colors duration-80 ease-snap hover:text-text"
          >
            load images
          </button>
          {senderId ? (
            <button
              type="button"
              onClick={() => {
                setLoadImages(true);
                void alwaysLoadImages(senderId);
              }}
              className="text-text-muted underline decoration-text-dim underline-offset-2 transition-colors duration-80 ease-snap hover:text-text"
            >
              always load from this sender
            </button>
          ) : null}
        </p>
      ) : null}
      <iframe
        ref={ref}
        title="message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={buildEmailDocument(html, { allowImages, plain })}
        onLoad={onLoad}
        // An inverted email renders light, so its own dark media queries stay off and are not inverted back.
        style={{ height, colorScheme: invert ? "light" : "dark" }}
        className={cn("w-full bg-transparent", !plain && "rounded-sm border border-border")}
      />
      {hasQuote && quoteLabel !== null ? <QuoteFold label={quoteLabel} open={quoteOpen} onToggle={toggleQuote} /> : null}
    </div>
  );
}
