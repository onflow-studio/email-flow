import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { attachments, messages } from "@/lib/db/schema";
import { ReauthRequiredError, getGmailClient } from "@/lib/gmail/client";
import { gmailLimiter } from "@/lib/gmail/quota";
import { demoAttachmentBytes, isDemoAttachment } from "@/lib/mail/demo-attachment";
import { baseType, isTextAttachment, opensInline } from "@/lib/mail/remote";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** One `bytes=start-end` range (or `start-`, or `-suffix`) within `size`; null when absent, "bad" when unsatisfiable. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "bad" {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return "bad";
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "bad" : { start, end };
}

// Attachment bytes on demand, fetched from Gmail. `?inline=1` opens safe types in the tab. A
// `Range` request answers with that slice alone, so files over Vercel's 4.5 MB response cap
// come down in parts (see ATTACHMENT_RANGE_BYTES).
export async function GET(request: NextRequest, { params }: RouteContext<"/api/attachments/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [row] = await db
    .select({
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      gmailAttachmentId: attachments.gmailAttachmentId,
      gmailMessageId: messages.gmailMessageId,
      accountId: messages.accountId,
    })
    .from(attachments)
    .innerJoin(messages, eq(attachments.messageId, messages.id))
    .where(eq(attachments.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let bytes: Buffer;
  if (isDemoAttachment(row.gmailAttachmentId)) {
    // The demo database (`pnpm seed`) has no Gmail message behind its files.
    bytes = demoAttachmentBytes(row.filename, row.mimeType);
  } else {
    let data: string | null | undefined;
    try {
      const gmail = await getGmailClient(row.accountId);
      const res = await gmailLimiter(row.accountId).run("messages.attachments.get", () =>
        gmail.users.messages.attachments.get({ userId: "me", messageId: row.gmailMessageId, id: row.gmailAttachmentId }),
      );
      data = res.data.data;
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        return NextResponse.json({ error: "reconnect required" }, { status: 409 });
      }
      console.error(`attachment ${id} fetch failed`, error);
      return NextResponse.json({ error: "gmail fetch failed, retry" }, { status: 502 });
    }
    if (!data) return NextResponse.json({ error: "gone from gmail" }, { status: 404 });
    bytes = Buffer.from(data, "base64url");
  }

  const mime = baseType(row.mimeType);
  const inline = request.nextUrl.searchParams.get("inline") === "1" && opensInline(mime);
  // Text types never render as anything but text.
  const inlineType = isTextAttachment(mime) ? "text/plain; charset=utf-8" : mime;
  const headers: Record<string, string> = {
    "Content-Type": inline ? inlineType : mime || "application/octet-stream",
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.filename),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // Chrome refuses to render a sandboxed PDF, so PDFs go without it.
    ...(mime === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:" }),
    "Cache-Control": "private, max-age=3600",
  };

  const range = parseRange(request.headers.get("range"), bytes.length);
  if (range === "bad") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
  }
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(slice.length),
        "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
