"use client";

import { ImageIcon, Paperclip } from "lucide-react";
import { useState } from "react";

import { attachmentUrl, opensInline, previewKind } from "@/lib/mail/remote";

import type { MessageItem } from "../message";
import { formatSize, listedAttachments, needsParts, type AttachmentFile } from "./files";
import { useAttachmentViewer } from "./viewer";

const GRID_PREVIEW = 8;

/** A message's attachments: images as a thumbnail grid, then other files as rows. Each opens the viewer. */
export function AttachmentList({ message }: { message: MessageItem }) {
  const viewer = useAttachmentViewer();
  const [showAll, setShowAll] = useState(false);
  const files = listedAttachments(message);
  if (!files.length) return null;
  const images = files.filter((a) => previewKind(a.mimeType) === "image");
  const others = files.filter((a) => previewKind(a.mimeType) !== "image");
  const shown = showAll ? images : images.slice(0, GRID_PREVIEW);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      {images.length ? (
        <div className="flex flex-col items-start gap-1">
          <ul className="grid w-full grid-cols-thumbs gap-1">
            {shown.map((a) => (
              <li key={a.id}>
                <Thumb file={a} onOpen={viewer ? () => viewer.open(a.id) : null} />
              </li>
            ))}
          </ul>
          {images.length > shown.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex h-touch items-center text-12 text-text-muted transition-colors duration-80 ease-snap hover:text-text focus-visible:text-text md:h-row"
            >
              show all {images.length}
            </button>
          ) : null}
        </div>
      ) : null}
      {others.length ? (
        <ul className="flex flex-col gap-1">
          {others.map((a) => (
            <li key={a.id}>
              <Row file={a} onOpen={viewer ? () => viewer.open(a.id) : null} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const thumbClass =
  "flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-surface outline-none transition-colors duration-80 ease-snap hover:border-text-muted focus-visible:border-accent";

function Thumb({ file, onOpen }: { file: AttachmentFile; onOpen: (() => void) | null }) {
  const [failed, setFailed] = useState(false);
  // A large image would pull its whole file to draw a cell.
  const picture = !needsParts(file) && !failed;
  const content = picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- attachment bytes from our own route
    <img
      src={attachmentUrl(file.id, { inline: true })}
      alt={file.filename}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  ) : (
    <span className="flex flex-col items-center gap-1 text-11 text-text-muted">
      <ImageIcon aria-hidden className="size-4 text-text-dim" strokeWidth={1.5} />
      {formatSize(file.size)}
    </span>
  );
  if (!onOpen) {
    return (
      <a href={attachmentUrl(file.id, { inline: true })} target="_blank" rel="noreferrer" title={file.filename} className={thumbClass}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onOpen} title={file.filename} aria-label={`view ${file.filename}`} className={thumbClass}>
      {content}
    </button>
  );
}

const rowClass =
  "flex h-touch w-full items-center gap-2 rounded-sm px-1 text-left text-text-muted md:h-row transition-colors duration-80 ease-snap hover:bg-surface-raised hover:text-text";

function Row({ file, onOpen }: { file: AttachmentFile; onOpen: (() => void) | null }) {
  const content = (
    <>
      <Paperclip aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate text-text">{file.filename}</span>
      <span className="shrink-0 text-11">{formatSize(file.size)}</span>
    </>
  );
  if (!onOpen) {
    const inline = opensInline(file.mimeType);
    return (
      <a
        href={attachmentUrl(file.id, { inline })}
        {...(inline ? { target: "_blank", rel: "noreferrer" } : { download: file.filename })}
        title={inline ? "open" : "download"}
        className={rowClass}
      >
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onOpen} title="view" className={rowClass}>
      {content}
    </button>
  );
}
