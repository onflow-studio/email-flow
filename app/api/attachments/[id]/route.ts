import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { attachments, messages } from "@/lib/db/schema";
import { ReauthRequiredError, getGmailClient } from "@/lib/gmail/client";
import { opensInline } from "@/lib/mail/remote";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Attachment bytes on demand, fetched from Gmail. `?inline=1` opens safe types in the tab.
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

  let data: string | null | undefined;
  try {
    const gmail = await getGmailClient(row.accountId);
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: row.gmailMessageId,
      id: row.gmailAttachmentId,
    });
    data = res.data.data;
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      return NextResponse.json({ error: "reconnect required" }, { status: 409 });
    }
    console.error(`attachment ${id} fetch failed`, error);
    return NextResponse.json({ error: "gmail fetch failed, retry" }, { status: 502 });
  }
  if (!data) return NextResponse.json({ error: "gone from gmail" }, { status: 404 });

  const bytes = Buffer.from(data, "base64url");
  const mime = row.mimeType.toLowerCase();
  const inline = request.nextUrl.searchParams.get("inline") === "1" && opensInline(mime);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? mime : mime || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.filename),
      "X-Content-Type-Options": "nosniff",
      // Chrome refuses to render a sandboxed PDF, so PDFs go without it.
      ...(mime === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
