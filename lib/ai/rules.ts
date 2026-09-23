import { Output, generateText } from "ai";
import { z } from "zod";

import { claude } from "./index";

// Structured hints for one natural-language rule. Stored in rules.structured next to the text;
// classify hands both to Jev, so a wrong parse degrades to the plain text, never overrides it.
export const ruleStructureSchema = z.object({
  match: z.object({
    senders: z.array(z.string()).describe("Exact sender email addresses, lowercased"),
    domains: z.array(z.string()).describe("Sender domains without @, lowercased, e.g. vercel.com"),
    subjectKeywords: z.array(z.string()).describe("Words or phrases the subject should contain"),
    bodyKeywords: z.array(z.string()).describe("Words or phrases the body should contain"),
    kind: z
      .enum(["any", "person", "newsletter", "receipt", "notification", "alert"])
      .describe("Kind of mail the rule is about, `any` when the rule does not say"),
  }),
  bucket: z
    .enum(["inbox", "news", "paper_trail"])
    .nullable()
    .describe("Bucket matching mail goes to, null when the rule does not say"),
  keepOut: z.boolean().describe("True when the rule says to block, ignore or keep out the sender"),
  urgent: z.boolean().nullable().describe("True when the rule says this mail is urgent, false if never urgent"),
  summary: z.string().describe("The rule restated in under 80 characters, lowercase, terse"),
});

export type RuleStructure = z.infer<typeof ruleStructureSchema>;

const INSTRUCTIONS = `You turn one email triage rule, written by the user in plain language, into structured hints.
The mail client sorts threads into buckets:
- inbox: mail the user should see and may act on, including urgent service notices
- news: newsletters, digests, announcements, promotions
- paper_trail: receipts, invoices, order and shipping updates, routine notifications
Only fill what the rule states or clearly implies. Leave lists empty and use null rather than guessing.
A company name like "Vercel" means its domain (vercel.com) when the domain is obvious.
Rules may be in English or Spanish.`;

export async function parseRule(text: string): Promise<RuleStructure> {
  const { output } = await generateText({
    model: claude(),
    system: INSTRUCTIONS,
    prompt: `Rule: ${text}`,
    output: Output.object({ schema: ruleStructureSchema, name: "rule" }),
  });
  return ruleStructureSchema.parse(output);
}
