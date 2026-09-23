import sanitizeHtml from "sanitize-html";

// Sanitized once on ingest, stored, rendered in a sandboxed iframe with a strict CSP.
// Remote images never load from stored HTML: <img> keeps the URL in data-remote-src and the
// renderer restores it only when the sender or message is allowed. Remote CSS urls are removed.

export const REMOTE_SRC_ATTR = "data-remote-src";

const REMOTE_URL = /^(https?:)?\/\//i;
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
const CSS_IMPORT = /@import[^;]*;?/gi;
// CSS escapes and comments can hide url( or expression(; drop those declarations outright.
const CSS_SUSPICIOUS = /expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\[0-9a-f]/i;

function cleanCss(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (CSS_SUSPICIOUS.test(withoutComments)) return "";
  return withoutComments.replace(CSS_IMPORT, "").replace(CSS_REMOTE_URL, "none");
}

function dimension(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Tracking pixels: 0 or 1px images, or images hidden with inline CSS.
function isTracker(attribs: Record<string, string>): boolean {
  const w = dimension(attribs.width);
  const h = dimension(attribs.height);
  if ((w !== null && w <= 1) || (h !== null && h <= 1)) return true;
  const style = (attribs.style ?? "").toLowerCase().replace(/\s+/g, "");
  return (
    style.includes("display:none") ||
    style.includes("visibility:hidden") ||
    /(^|;)(width|height):[01](px)?(;|$)/.test(style)
  );
}

const LAYOUT_ATTRS = [
  "style",
  "class",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "color",
  "border",
  "cellpadding",
  "cellspacing",
  "dir",
  "lang",
  "title",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "style",
    "center",
    "font",
    "u",
    "s",
    "del",
    "ins",
    "big",
    "small",
    "sub",
    "sup",
  ],
  // <style> is safe here: scripts are gone, the iframe is sandboxed, and cleanCss strips loads.
  allowVulnerableTags: true,
  nonTextTags: ["script", "textarea", "option", "noscript", "title"],
  allowedAttributes: {
    "*": LAYOUT_ATTRS,
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", REMOTE_SRC_ATTR],
    font: ["face", "size", "color"],
    td: ["colspan", "rowspan", "nowrap"],
    th: ["colspan", "rowspan", "nowrap", "scope"],
    ol: ["start", "type"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["cid", "data"] },
  allowProtocolRelative: false,
  transformTags: {
    "*": (tagName, attribs) => {
      const next = { ...attribs };
      if (next.style) {
        const style = cleanCss(next.style);
        if (style.trim()) next.style = style;
        else delete next.style;
      }
      if (tagName === "a" && next.href) {
        next.target = "_blank";
        next.rel = "noopener noreferrer nofollow";
      }
      if (tagName === "img" && next.src && REMOTE_URL.test(next.src)) {
        next[REMOTE_SRC_ATTR] = next.src.startsWith("//") ? `https:${next.src}` : next.src;
        delete next.src;
      }
      return { tagName, attribs: next };
    },
  },
  exclusiveFilter: (frame) => frame.tag === "img" && isTracker(frame.attribs),
};

// sanitize-html passes <style> bodies through raw, so they are cleaned after.
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
    .replace(STYLE_BLOCK, (_, css: string) => {
      const clean = cleanCss(css).trim();
      return clean ? `<style>${clean}</style>` : "";
    })
    .trim();
}

// True when the stored HTML has remote images waiting for permission.
export function hasBlockedImages(html: string | null): boolean {
  return Boolean(html?.includes(`${REMOTE_SRC_ATTR}=`));
}
