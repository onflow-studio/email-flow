import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it } from "vitest";

import { REMOTE_SRC_ATTR } from "@/lib/mail/sanitize";
import { parseGmailMessage } from "@/lib/mail/mime";

import { deriveThreadFields } from "./store";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function message(overrides: Partial<gmail_v1.Schema$Message> = {}): gmail_v1.Schema$Message {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    internalDate: String(Date.parse("2026-09-23T09:30:00Z")),
    snippet: "Your invoice &amp; receipt",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: '"Vercel, Inc." <Billing@Vercel.com>' },
        { name: "To", value: "Fer <me@work2.example>, other@x.com" },
        { name: "Subject", value: "=?UTF-8?B?RmFjdHVyYSBkZSBzZXB0aWVtYnJl?=" },
        { name: "List-Unsubscribe", value: "<mailto:u@vercel.com>" },
        { name: "Message-ID", value: "<abc@vercel.com>" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="utf-8"' }], body: { data: b64("Payment failed for your Pro plan. Update your card.") } },
            {
              mimeType: "text/html",
              body: {
                data: b64(
                  '<p onclick="x()">Payment <b>failed</b></p><script>steal()</script>' +
                    '<img src="https://track.vercel.com/o.gif" width="1" height="1"><img src="https://cdn.vercel.com/logo.png">',
                ),
              },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          headers: [{ name: "Content-Disposition", value: 'attachment; filename="invoice.pdf"' }],
          body: { attachmentId: "ATT1", size: 2048 },
        },
      ],
    },
    ...overrides,
  };
}

describe("parseGmailMessage", () => {
  const parsed = parseGmailMessage(message());

  it("reads addresses, decoded subject, date and headers", () => {
    expect(parsed.from).toEqual({ name: "Vercel, Inc.", email: "billing@vercel.com" });
    expect(parsed.to).toEqual([
      { name: "Fer", email: "me@work2.example" },
      { name: null, email: "other@x.com" },
    ]);
    expect(parsed.subject).toBe("Factura de septiembre");
    expect(parsed.date.toISOString()).toBe("2026-09-23T09:30:00.000Z");
    expect(parsed.snippet).toBe("Your invoice & receipt");
    expect(parsed.headers).toEqual({ messageId: "<abc@vercel.com>", listUnsubscribe: "<mailto:u@vercel.com>" });
  });

  it("sanitizes HTML: no scripts or handlers, tracker dropped, remote image blocked", () => {
    const html = parsed.htmlSanitized ?? "";
    expect(html).not.toMatch(/script|onclick|steal/);
    expect(html).not.toContain("track.vercel.com");
    expect(html).toContain(`${REMOTE_SRC_ATTR}="https://cdn.vercel.com/logo.png"`);
    expect(html).not.toMatch(/\ssrc="https:/);
  });

  it("prefers the text part and keeps attachment metadata only", () => {
    expect(parsed.text).toBe("Payment failed for your Pro plan. Update your card.");
    expect(parsed.attachments).toEqual([
      { filename: "invoice.pdf", mimeType: "application/pdf", size: 2048, gmailAttachmentId: "ATT1", contentId: null },
    ]);
  });

  it("derives text from HTML when there is no text part", () => {
    const htmlOnly = parseGmailMessage(
      message({ payload: { mimeType: "text/html", headers: [{ name: "From", value: "a@b.com" }], body: { data: b64("<h1>Hello</h1><p>World of mail</p>") } } }),
    );
    expect(htmlOnly.text).toMatch(/HELLO|Hello/);
    expect(htmlOnly.text).toContain("World of mail");
  });

  it("decodes non-UTF-8 charsets", () => {
    const latin1 = parseGmailMessage(
      message({
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "From", value: "a@b.com" }, { name: "Content-Type", value: "text/plain; charset=ISO-8859-1" }],
          body: { data: Buffer.from("Información útil para el año", "latin1").toString("base64url") },
        },
      }),
    );
    expect(latin1.text).toBe("Información útil para el año");
  });
});

describe("deriveThreadFields", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 23, h));

  it("subject and sender from the first inbound message, last date, participants in order", () => {
    expect(
      deriveThreadFields([
        { date: at(12), fromName: null, fromEmail: "me@x.com", subject: "Re: plan", isInbound: false, senderId: null },
        { date: at(9), fromName: "Ana", fromEmail: "ana@y.com", subject: "plan", isInbound: true, senderId: "s-ana" },
        { date: at(10), fromName: null, fromEmail: "bob@z.com", subject: "Re: plan", isInbound: true, senderId: "s-bob" },
      ]),
    ).toEqual({
      subject: "plan",
      lastMessageAt: at(12),
      senderId: "s-ana",
      participantsSummary: "Ana, bob, me",
      hasInbound: true,
    });
  });

  it("a thread the user started has no inbound sender until someone replies", () => {
    const fields = deriveThreadFields([
      { date: at(9), fromName: null, fromEmail: "me@x.com", subject: "hi", isInbound: false, senderId: null },
    ]);
    expect(fields).toMatchObject({ senderId: null, hasInbound: false, participantsSummary: "me" });
  });

  it("caps participants at three", () => {
    const rows = ["a", "b", "c", "d", "e"].map((n, i) => ({
      date: at(i),
      fromName: n,
      fromEmail: `${n}@x.com`,
      subject: null,
      isInbound: true,
      senderId: n,
    }));
    expect(deriveThreadFields(rows).participantsSummary).toBe("a, b, c +2");
  });
});
