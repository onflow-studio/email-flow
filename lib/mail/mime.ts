import type { gmail_v1 } from "@googleapis/gmail";

import type { Address, MessageHeaders } from "@/lib/db/schema";

import { decodeEncodedWords, parseAddress, parseAddressList } from "./address";
import { sanitizeEmailHtml } from "./sanitize";
import { decodeSnippet, extractText } from "./text";

export type ParsedAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
  contentId: string | null;
};

export type ParsedMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  labelIds: string[];
  date: Date;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string | null;
  snippet: string | null;
  htmlSanitized: string | null;
  text: string | null;
  headers: MessageHeaders;
  attachments: ParsedAttachment[];
};

type Part = gmail_v1.Schema$MessagePart;

function headerMap(part: Part | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of part?.headers ?? []) {
    if (h.name && h.value != null && !map.has(h.name.toLowerCase())) {
      map.set(h.name.toLowerCase(), h.value);
    }
  }
  return map;
}

function charsetOf(part: Part): string {
  const type = headerMap(part).get("content-type") ?? "";
  return type.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? "utf-8";
}

// Gmail often hands back text parts already transcoded to UTF-8 while the part header still
// declares the original charset (Outlook's ISO-8859-1), so valid UTF-8 wins over the label.
function decodeBody(part: Part): string {
  const bytes = Buffer.from(part.body?.data ?? "", "base64url");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder(charsetOf(part)).decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

type Walked = { html: string[]; plain: string[]; attachments: ParsedAttachment[] };

function walk(part: Part, out: Walked) {
  const mime = (part.mimeType ?? "").toLowerCase();
  const headers = headerMap(part);
  const disposition = headers.get("content-disposition")?.toLowerCase() ?? "";

  const contentId = headers.get("content-id")?.trim().replace(/^<|>$/g, "") ?? null;
  // Inline images often carry only a Content-ID, no filename.
  if (part.body?.attachmentId && (part.filename || contentId || disposition.startsWith("attachment"))) {
    out.attachments.push({
      filename: part.filename || contentId || "attachment",
      mimeType: mime || "application/octet-stream",
      size: part.body.size ?? 0,
      gmailAttachmentId: part.body.attachmentId,
      contentId,
    });
    return;
  }
  if (part.parts?.length) {
    // multipart/alternative: the richest part is last; keep both html and plain anyway.
    for (const child of part.parts) walk(child, out);
    return;
  }
  if (!part.body?.data || disposition.startsWith("attachment")) return;
  if (mime === "text/html") out.html.push(decodeBody(part));
  else if (mime === "text/plain") out.plain.push(decodeBody(part));
}

function pickHeaders(h: Map<string, string>): MessageHeaders {
  const out: MessageHeaders = {
    messageId: h.get("message-id"),
    inReplyTo: h.get("in-reply-to"),
    references: h.get("references"),
    listUnsubscribe: h.get("list-unsubscribe"),
    listUnsubscribePost: h.get("list-unsubscribe-post"),
    precedence: h.get("precedence"),
    autoSubmitted: h.get("auto-submitted"),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as MessageHeaders;
}

// A Gmail `format: full` message into the columns sync stores.
export function parseGmailMessage(message: gmail_v1.Schema$Message): ParsedMessage {
  if (!message.id || !message.threadId) throw new Error("Gmail message without id or threadId");
  const headers = headerMap(message.payload);
  const walked: Walked = { html: [], plain: [], attachments: [] };
  if (message.payload) walk(message.payload, walked);

  const rawHtml = walked.html.join("\n");
  const htmlSanitized = rawHtml ? sanitizeEmailHtml(rawHtml) || null : null;
  const plain = walked.plain.join("\n\n") || null;
  const from = parseAddress(decodeEncodedWords(headers.get("from") ?? "")) ?? {
    name: null,
    email: "unknown@invalid",
  };
  const internal = Number(message.internalDate);
  const headerDate = headers.get("date") ? new Date(headers.get("date")!) : null;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    labelIds: message.labelIds ?? [],
    // internalDate is when Gmail received it, immune to bad sender clocks.
    date: Number.isFinite(internal) && internal > 0
      ? new Date(internal)
      : headerDate && !Number.isNaN(headerDate.getTime())
        ? headerDate
        : new Date(0),
    from,
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    bcc: parseAddressList(headers.get("bcc")),
    subject: headers.has("subject") ? decodeEncodedWords(headers.get("subject")!).trim() || null : null,
    snippet: decodeSnippet(message.snippet),
    htmlSanitized,
    text: extractText(plain, htmlSanitized),
    headers: pickHeaders(headers),
    attachments: walked.attachments,
  };
}
