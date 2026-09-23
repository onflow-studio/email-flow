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
