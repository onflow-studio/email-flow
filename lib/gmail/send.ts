import { randomBytes } from "node:crypto";

import { convert } from "html-to-text";

import type { Address } from "@/lib/db/schema";

import { getGmailClient } from "./client";
import { gmailLimiter } from "./quota";

export type OutgoingAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
  /** Set for images referenced from the HTML as `cid:`. */
  contentId?: string;
};

export type OutgoingMessage = {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** Body fragment. Data URL images are moved into inline parts on build. */
  html: string;
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
};

// Header values never carry line breaks, so user input cannot inject headers.
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const isPlainAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

/** RFC 2047 B-encoding, split so every encoded word stays under 75 characters. */
export function encodeHeaderText(value: string): string {
  const text = oneLine(value);
  if (isPlainAscii(text)) return text;
  const words: string[] = [];
  let chunk = "";
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function formatAddress(a: Address): string {
  const email = oneLine(a.email);
  if (!a.name) return email;
  const name = oneLine(a.name);
  if (!isPlainAscii(name)) return `${encodeHeaderText(name)} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** Plain text alternative. Links keep their URL, images are dropped. */
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "blockquote", format: "blockquote", options: { trimEmptyLines: true } },
    ],
  }).trim();
}

const DATA_IMAGE = /src="data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)"/g;

/** Moves pasted data URL images into `cid:` parts, which Gmail and most clients render. */
export function extractInlineImages(html: string): { html: string; images: OutgoingAttachment[] } {
  const images: OutgoingAttachment[] = [];
  const out = html.replace(DATA_IMAGE, (_, mimeType: string, data: string) => {
    const contentId = `img${images.length + 1}.${randomBytes(6).toString("hex")}@superfer`;
    images.push({
      filename: `image-${images.length + 1}.${mimeType.split("/")[1]}`,
      mimeType,
      data: Buffer.from(data, "base64"),
      contentId,
    });
    return `src="cid:${contentId}"`;
  });
  return { html: out, images };
}

const boundary = () => `sf_${randomBytes(12).toString("hex")}`;

const base64Lines = (data: Buffer) => data.toString("base64").replace(/.{76}/g, "$&\r\n");

function textPart(mimeType: "text/plain" | "text/html", body: string): string {
  return [
    `Content-Type: ${mimeType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(body)),
  ].join("\r\n");
}

function filenameParam(filename: string): string {
  const clean = oneLine(filename).replace(/["\\]/g, "_");
  return isPlainAscii(clean) ? `"${clean}"` : `"${encodeHeaderText(clean)}"`;
}

function attachmentPart(a: OutgoingAttachment): string {
  const disposition = a.contentId ? "inline" : "attachment";
  return [
    `Content-Type: ${oneLine(a.mimeType)}; name=${filenameParam(a.filename)}`,
    `Content-Disposition: ${disposition}; filename=${filenameParam(a.filename)}`,
    ...(a.contentId ? [`Content-ID: <${a.contentId}>`] : []),
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(a.data),
  ].join("\r\n");
}

function multipart(subtype: "mixed" | "related" | "alternative", parts: string[]): string {
  const b = boundary();
  return [
    `Content-Type: multipart/${subtype}; boundary="${b}"`,
    "",
    ...parts.map((p) => `--${b}\r\n${p}`),
    `--${b}--`,
    "",
  ].join("\r\n");
}

function htmlDocument(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

/** RFC 5322 message. From is left out so Gmail fills in the account's own name and address. */
export function buildMime(message: OutgoingMessage, date = new Date()): string {
  const { html, images } = extractInlineImages(message.html);
  const files = message.attachments ?? [];

  let body = multipart("alternative", [
    textPart("text/plain", htmlToPlainText(html)),
    textPart("text/html", htmlDocument(html)),
  ]);
  const inline = [...images, ...files.filter((f) => f.contentId)];
  if (inline.length) body = multipart("related", [body, ...inline.map(attachmentPart)]);
  const attached = files.filter((f) => !f.contentId);
  if (attached.length) body = multipart("mixed", [body, ...attached.map(attachmentPart)]);

  const headers = [
    "MIME-Version: 1.0",
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    ...(message.to.length ? [`To: ${message.to.map(formatAddress).join(", ")}`] : []),
    ...(message.cc.length ? [`Cc: ${message.cc.map(formatAddress).join(", ")}`] : []),
    ...(message.bcc.length ? [`Bcc: ${message.bcc.map(formatAddress).join(", ")}`] : []),
    ...(message.inReplyTo ? [`In-Reply-To: ${oneLine(message.inReplyTo)}`] : []),
    ...(message.references ? [`References: ${oneLine(message.references)}`] : []),
  ];
  return `${headers.join("\r\n")}\r\n${body}`;
}

/** Sends through Gmail. Pass the Gmail thread id for replies and forwards so Gmail threads them. */
export async function sendMessage(
  accountId: string,
  message: OutgoingMessage,
  gmailThreadId?: string,
): Promise<{ gmailMessageId: string; gmailThreadId: string }> {
  const gmail = await getGmailClient(accountId);
  // Media upload rather than `raw` in the body: allows up to 35 MB with attachments.
  const res = await gmailLimiter(accountId).run("messages.send", () =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: gmailThreadId ? { threadId: gmailThreadId } : {},
      media: { mimeType: "message/rfc822", body: buildMime(message) },
    }),
  );
  if (!res.data.id || !res.data.threadId) throw new Error("Gmail did not return the sent message");
  return { gmailMessageId: res.data.id, gmailThreadId: res.data.threadId };
}

export async function fetchAttachment(
  accountId: string,
  gmailMessageId: string,
  gmailAttachmentId: string,
): Promise<Buffer> {
  const gmail = await getGmailClient(accountId);
  const res = await gmailLimiter(accountId).run("messages.attachments.get", () =>
    gmail.users.messages.attachments.get({ userId: "me", messageId: gmailMessageId, id: gmailAttachmentId }),
  );
  if (!res.data.data) throw new Error("Gmail returned an empty attachment");
  return Buffer.from(res.data.data, "base64url");
}

export type ReplyHeaders = { messageId: string | null; references: string | null; replyTo: string | null };

/** Threading and Reply-To headers of one message, read from Gmail. */
export async function fetchReplyHeaders(accountId: string, gmailMessageId: string): Promise<ReplyHeaders> {
  const gmail = await getGmailClient(accountId);
  const res = await gmailLimiter(accountId).run("messages.get", () =>
    gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References", "Reply-To"],
    }),
  );
  const find = (name: string) =>
    res.data.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
  return { messageId: find("Message-ID"), references: find("References"), replyTo: find("Reply-To") };
}
