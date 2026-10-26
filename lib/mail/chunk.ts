import { splitTextQuote } from "./quote";

export const CHUNK_CHARS = 1500;
export const CHUNK_OVERLAP = 200;
export const MAX_CHUNKS = 8;

type MessageToChunk = {
  subject: string | null;
  fromName: string | null;
  fromEmail: string;
  text: string | null;
  attachments: string[];
};

export type MessageChunk = {
  chunk: number;
  text: string;
  metadata: { attachments: string[] } | null;
};

function normalize(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function cutAt(body: string, start: number, target: number) {
  const slice = body.slice(start, target);
  const halfway = Math.floor(slice.length / 2);
  const paragraph = slice.lastIndexOf("\n\n");
  if (paragraph >= halfway) return start + paragraph + 2;
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentence >= halfway) return start + sentence + 2;
  const space = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return space >= halfway ? start + space + 1 : target;
}

export function chunkMessage(message: MessageToChunk): MessageChunk[] {
  const header = `subject: ${normalize(message.subject ?? "") || "(no subject)"}\nfrom: ${message.fromName?.trim() ? `${normalize(message.fromName)} ` : ""}<${message.fromEmail.trim()}>\n\n`;
  const body = normalize(splitTextQuote(message.text ?? "").body);
  const chunks: MessageChunk[] = [];
  let start = 0;
  do {
    const end = Math.min(body.length, start + CHUNK_CHARS);
    const cut = end === body.length ? end : cutAt(body, start, end);
    const attachments = chunks.length === 0 && message.attachments.length > 0
      ? `attachments: ${message.attachments.join(", ")}\n\n`
      : "";
    chunks.push({
      chunk: chunks.length,
      text: header + attachments + body.slice(start, cut).trim(),
      metadata: chunks.length === 0 ? { attachments: message.attachments } : null,
    });
    if (cut >= body.length) break;
    start = Math.max(start + 1, cut - CHUNK_OVERLAP);
  } while (chunks.length < MAX_CHUNKS);
  return chunks;
}
