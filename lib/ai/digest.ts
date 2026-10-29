import type { LanguageModel } from "ai";
import { z } from "zod";

import type { DigestContent, DigestItem } from "@/lib/db/schema";

import { claude, generateStructured, type StructuredRequest } from "./index";

export const DIGEST_LINE_LIMIT = 40;

const digestSummarySchema = z.object({
  lines: z.array(z.string()).min(2).max(5).describe("2 to 5 short lines on what matters today"),
});

const SYSTEM = `You write the top of a daily email digest for one person who reads mail from several accounts.
You get yesterday's counts and a list of threads: deadlines, threads waiting on a reply, and new Inbox mail.
Write 2 to 5 short lines on what matters today, most important first.
- Name the deadlines and replies that need attention by what they are about, not by count alone.
- Mention counts only where they help, e.g. a full Triage. Use the counts given, never your own.
- Sentence case, plain words, no greeting, no hype, no emoji, no markdown.
- Each line under 100 characters.
- Write in the language most of the mail is in.`;

type Line = { kind: "deadline" | "reply" | "inbox"; item: DigestItem; note?: string };

/** Deadlines first, then replies, then Inbox arrivals; each thread once, at most 40 lines. */
export function digestLines(content: DigestContent): Line[] {
  const lines: Line[] = [
    ...content.deadlines.items.map((item) => ({
      kind: "deadline" as const,
      item,
      note: `${item.overdue ? "overdue since" : "due"} ${item.deadlineAt}`,
    })),
    ...content.needsReply.items.map((item) => ({ kind: "reply" as const, item, note: `waiting ${item.days} days` })),
    ...content.inbox.map((item) => ({ kind: "inbox" as const, item })),
  ];
  const seen = new Set<string>();
  const unique = lines.filter(({ item }) => {
    if (seen.has(item.threadId)) return false;
    seen.add(item.threadId);
    return true;
  });
  return unique.slice(0, DIGEST_LINE_LIMIT);
}

export function buildDigestPrompt(content: DigestContent): StructuredRequest<z.infer<typeof digestSummarySchema>> {
  const { arrivals, triage, stale } = content;
  const counts = [
    `Arrived in the last 24 hours: inbox ${arrivals.inbox}, news ${arrivals.news}, paper trail ${arrivals.paper_trail}, receipts ${arrivals.receipts}, triage ${arrivals.triage}.`,
    `Waiting on a reply past the owner's limit: ${content.needsReply.total}. Deadlines overdue or due within 24 hours: ${content.deadlines.total}.`,
    `Waiting in Triage past the owner's limit: ${triage}.`,
    `Work threads quiet past the owner's limit: ${stale.work}.`,
  ];
  const threads = digestLines(content).map(({ kind, item, note }) =>
    [`- [${kind}]`, item.subject, `(${item.account}${note ? `, ${note}` : ""})`, item.summary ? `: ${item.summary}` : ""].join(" ").trim(),
  );
  return {
    system: SYSTEM,
    prompt: [`Now: ${content.until}.`, ...counts, "", "Threads:", ...(threads.length ? threads : ["(none)"])].join("\n"),
    schema: digestSummarySchema,
    name: "digest",
  };
}

/** One Claude call. Throws on any error, so the digest job retries with backoff. */
export async function summarizeDigest(content: DigestContent, options: { model?: LanguageModel } = {}) {
  const { output, modelId } = await generateStructured(buildDigestPrompt(content), { model: options.model ?? claude() });
  const lines = output.lines.map((line) => line.trim()).filter(Boolean);
  return { lines, modelId };
}
