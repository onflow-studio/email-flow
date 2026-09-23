"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Declares a dark scheme via meta, CSS `color-scheme`, or a dark media query. */
export function declaresDarkScheme(html: string) {
  return (
    /<meta[^>]+name=["']?color-scheme["']?[^>]*content=["'][^"']*dark/i.test(html) ||
    /<meta[^>]+content=["'][^"']*dark[^"']*["'][^>]*name=["']?color-scheme/i.test(html) ||
    /color-scheme\s*:\s*[^;}"']*dark/i.test(html) ||
    /prefers-color-scheme\s*:\s*dark/i.test(html)
  );
}

export function hasRemoteImages(html: string) {
  return (
    /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /background\s*=\s*["']?\s*(https?:)?\/\//i.test(html)
  );
}

// CSP does not govern navigation; a refresh would load a remote page in the frame.
const META_REFRESH = /<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi;

/**
 * Builds the iframe document. The CSP is the only thing standing between the
 * email and the network: no scripts, no remote styles or fonts, no forms, and
 * remote images only when explicitly allowed.
 */
export function buildEmailDocument(html: string, { allowImages }: { allowImages: boolean }) {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "font-src data:",
    `img-src data: cid:${allowImages ? " https: http:" : ""}`,
    "media-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  // Light emails get inverted with a hue rotation so brand colors keep their
  // hue; media is inverted back so photos look right.
  const invert = !declaresDarkScheme(html);
  // #e3e9ef lands near --surface after invert and hue rotation, so bare emails sit on the pane color.
  const invertCss = invert
    ? `html{background:#e3e9ef;filter:invert(1) hue-rotate(180deg)}
img,picture,video,svg,[style*="background-image"],[background]{filter:invert(1) hue-rotate(180deg)}`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>html,body{margin:0}body{padding:12px;overflow-wrap:anywhere;font-family:system-ui,sans-serif}img{max-width:100%;height:auto}${invertCss}</style>
</head><body>${html.replace(META_REFRESH, "")}</body></html>`;
}

export function EmailFrame({ html, imagesAllowed }: { html: string; imagesAllowed: boolean }) {
  const [loadImages, setLoadImages] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const allowImages = imagesAllowed || loadImages;
  const blocked = !allowImages && hasRemoteImages(html);

  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.documentElement) setHeight(doc.documentElement.scrollHeight);
  }, []);

  // Same-origin sandbox (no scripts) lets the parent size the frame to its
  // content and forward keys, so j/k keep working after a click in the email.
  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    measure();
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
  }, [measure]);

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
        </p>
      ) : null}
      <iframe
        ref={ref}
        title="message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={buildEmailDocument(html, { allowImages })}
        onLoad={onLoad}
        style={{ height }}
        className="w-full rounded-sm border border-border bg-transparent"
      />
    </div>
  );
}
