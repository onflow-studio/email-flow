// Client-safe helpers shared by ingest and the reading pane. No server imports.

// Sanitize moves remote <img> URLs here; the frame restores them only when images are allowed.
export const REMOTE_SRC_ATTR = "data-remote-src";

const REMOTE_SRC = new RegExp(`\\s${REMOTE_SRC_ATTR}="([^"]*)"`, "g");

export function hasBlockedImages(html: string | null): boolean {
  return Boolean(html?.includes(`${REMOTE_SRC_ATTR}=`));
}

export function restoreRemoteImages(html: string): string {
  return html.replace(REMOTE_SRC, ' src="$1"');
}

// The only types the attachment route will show in a tab; everything else downloads, so an HTML
// or SVG attachment can never run on our origin. Text types are served as text/plain.
export const INLINE_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
]);

const TEXT_ATTACHMENT_TYPES = new Set(["text/plain", "text/csv", "text/markdown", "application/json"]);

/** The type without parameters, lowercased: `Text/Plain; charset=utf-8` is `text/plain`. */
export function baseType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function opensInline(mimeType: string): boolean {
  return INLINE_ATTACHMENT_TYPES.has(baseType(mimeType));
}

export function isTextAttachment(mimeType: string): boolean {
  return TEXT_ATTACHMENT_TYPES.has(baseType(mimeType));
}

export type PreviewKind = "image" | "pdf" | "text" | "other";

/** How the attachment viewer shows a type. Only allowlisted types preview; nothing renders as HTML. */
export function previewKind(mimeType: string): PreviewKind {
  const type = baseType(mimeType);
  if (!INLINE_ATTACHMENT_TYPES.has(type)) return "other";
  if (type === "application/pdf") return "pdf";
  if (TEXT_ATTACHMENT_TYPES.has(type)) return "text";
  return "image";
}

/**
 * Vercel caps a function response at 4.5 MB, so larger files come from the route in ranges of
 * this size and are put back together in the browser.
 */
export const ATTACHMENT_RANGE_BYTES = 4 * 1024 * 1024;

// Attachment bytes via our route. Inline opens safe types (PDF, images, text) in the browser.
export function attachmentUrl(id: string, { inline = false } = {}): string {
  return `/api/attachments/${id}${inline ? "?inline=1" : ""}`;
}

const CID_SRC = /(<img\b[^>]*\ssrc=")cid:([^"]+)(")/gi;

// Inline images (logos, signatures) point at MIME parts; the iframe can't resolve cid:, our route can.
export function rewriteCidImages(html: string, byContentId: Map<string, string>): string {
  return html.replace(CID_SRC, (whole, before: string, cid: string, after: string) => {
    const id = byContentId.get(cid.trim().replace(/^<|>$/g, "").toLowerCase());
    return id ? `${before}${attachmentUrl(id, { inline: true })}${after}` : whole;
  });
}
