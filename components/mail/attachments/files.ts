import { ATTACHMENT_RANGE_BYTES, attachmentUrl, baseType, isTextAttachment, opensInline } from "@/lib/mail/remote";

import type { MessageItem } from "../message";

export type AttachmentFile = MessageItem["attachments"][number];

/** Gmail sends nothing larger, so a bigger file is not previewed. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

/** Text shows up to this much; the rest is a download away. */
export const TEXT_MAX_BYTES = 1024 * 1024;

/** Files above the route's single-response size come down in ranges. */
export function needsParts(file: AttachmentFile) {
  return file.size > ATTACHMENT_RANGE_BYTES;
}

/** A message's listed attachments: images the HTML shows inline (`cid:`) stay out. */
export function listedAttachments(m: Pick<MessageItem, "attachments" | "htmlSanitized">): AttachmentFile[] {
  return m.attachments.filter((a) => !m.htmlSanitized?.includes(attachmentUrl(a.id, { inline: true })));
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} mb`;
}

async function fetchRange(id: string, start: number, end: number, signal?: AbortSignal) {
  const res = await fetch(attachmentUrl(id), { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`);
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  return { buffer: await res.arrayBuffer(), total: res.status === 206 && Number.isFinite(total) ? total : null };
}

/**
 * The whole file as a Blob, in ATTACHMENT_RANGE_BYTES parts so no single response passes
 * Vercel's 4.5 MB cap. The Blob only keeps the file's own type when it may show inline, and text
 * is text/plain, as the route serves it.
 */
export async function fetchInParts(
  file: AttachmentFile,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Blob> {
  const type = isTextAttachment(file.mimeType)
    ? "text/plain;charset=utf-8"
    : opensInline(file.mimeType)
      ? baseType(file.mimeType)
      : "application/octet-stream";
  const first = await fetchRange(file.id, 0, ATTACHMENT_RANGE_BYTES - 1, signal);
  // A 200 means the route sent everything at once.
  if (first.total === null) return new Blob([first.buffer], { type });
  const total = first.total;
  const parts: ArrayBuffer[] = [first.buffer];
  let done = first.buffer.byteLength;
  onProgress?.(done / total);
  const starts: number[] = [];
  for (let start = ATTACHMENT_RANGE_BYTES; start < total; start += ATTACHMENT_RANGE_BYTES) starts.push(start);
  // Three at a time: each part is one Gmail fetch.
  for (let i = 0; i < starts.length; i += 3) {
    const batch = await Promise.all(
      starts.slice(i, i + 3).map((start) => fetchRange(file.id, start, Math.min(start + ATTACHMENT_RANGE_BYTES, total) - 1, signal)),
    );
    for (const part of batch) {
      parts.push(part.buffer);
      done += part.buffer.byteLength;
    }
    onProgress?.(done / total);
  }
  return new Blob(parts, { type });
}

/** Saves `href` under `filename` without leaving the page. */
export function saveAs(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.append(a);
  a.click();
  a.remove();
}
