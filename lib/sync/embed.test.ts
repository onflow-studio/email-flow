import { describe, expect, it } from "vitest";

import { EMBEDDING_MODEL } from "@/lib/ai";
import { CHUNK_CHARS, MAX_CHUNKS, chunkMessage } from "@/lib/mail/chunk";

import { planEmbeds } from "./embed";

const base = {
  subject: "Invoice",
  fromName: "Alex Rivera",
  fromEmail: "alex@example.com",
  text: "Please see the invoice.",
  attachments: [] as string[],
};

describe("chunkMessage", () => {
  it("embeds a short message with its header", () => {
    expect(chunkMessage(base)).toEqual([{
      chunk: 0,
      text: "subject: Invoice\nfrom: Alex Rivera <alex@example.com>\n\nPlease see the invoice.",
      metadata: { attachments: [] },
    }]);
  });

  it("splits with overlap and caps huge messages at eight chunks", () => {
    const body = Array.from({ length: 3000 }, (_, i) => `word${String(i).padStart(4, "0")}`).join(" ");
    const chunks = chunkMessage({ ...base, text: body });
    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(chunks.map((chunk) => chunk.chunk)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(chunks[0].text.length).toBeLessThan(CHUNK_CHARS + 100);
    expect(chunks[1].text).toContain(chunks[0].text.slice(-100));
    expect(chunks[7].text).not.toContain("word2999");
  });

  it("drops trailing quoted replies", () => {
    const [chunk] = chunkMessage({ ...base, text: "My answer.\n\nOn Tuesday, Alex wrote:\n> Old question\n> More quoted mail" });
    expect(chunk.text).toContain("My answer.");
    expect(chunk.text).not.toContain("Old question");
  });

  it("includes attachment names and metadata only on chunk zero", () => {
    const chunks = chunkMessage({ ...base, attachments: ["invoice.pdf", "notes.txt"], text: "A long sentence. ".repeat(200) });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain("attachments: invoice.pdf, notes.txt");
    expect(chunks[0].metadata).toEqual({ attachments: ["invoice.pdf", "notes.txt"] });
    expect(chunks[1].text).not.toContain("attachments:");
    expect(chunks[1].metadata).toBeNull();
  });

  it("still emits a row for an empty body", () => {
    expect(chunkMessage({ ...base, subject: null, text: null })).toEqual([{
      chunk: 0,
      text: "subject: (no subject)\nfrom: Alex Rivera <alex@example.com>\n\n",
      metadata: { attachments: [] },
    }]);
  });
});

describe("planEmbeds", () => {
  const message = { id: "message-1", subject: "Invoice", fromName: null, fromEmail: "alex@example.com", text: "Hello" };
  const open = { spam: false, trashed: false };

  it("skips messages already embedded with the current model", () => {
    expect(planEmbeds(open, [message], [{ messageId: message.id, model: EMBEDDING_MODEL }]))
      .toEqual({ messages: [], deleteMessageIds: [] });
  });

  it("replaces rows from a previous model", () => {
    expect(planEmbeds(open, [message], [{ messageId: message.id, model: "old-model" }]))
      .toEqual({ messages: [message], deleteMessageIds: [message.id] });
  });

  it("skips spam and trash", () => {
    for (const thread of [{ spam: true, trashed: false }, { spam: false, trashed: true }]) {
      expect(planEmbeds(thread, [message], [])).toEqual({ messages: [], deleteMessageIds: [] });
    }
  });
});
