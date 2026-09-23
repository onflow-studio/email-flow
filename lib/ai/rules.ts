import { Output, generateText } from "ai";
import { z } from "zod";

import { claude } from "./index";

// Structured hints for one natural-language rule. Stored in rules.structured next to the text;
// classify hands both to Jev, so a wrong parse degrades to the plain text, never overrides it.
export const ruleStructureSchema = z.object({
  // Checked literally by lib/classify. Every non-empty list must match for the rule to apply.
  match: z.object({
    senders: z.array(z.string()).describe("Exact sender email addresses, lowercased"),
    domains: z.array(z.string()).describe("Sender domains without @, lowercased, e.g. vercel.com"),
    accounts: z
      .array(z.string())
      .describe("The user's own receiving accounts the rule is limited to, as email or label, e.g. work1"),
    subjectKeywords: z
      .array(z.string())
      .describe("Only words the rule says the subject literally contains, lowercased"),
  }),
  semantic: z
    .string()
    .nullable()
    .describe(
      "The part of the condition that needs judgment rather than literal matching, e.g. 'failed payments' " +
        "or 'newsletters', null when the rule is fully literal",
    ),
  bucket: z
    .enum(["inbox", "news", "paper_trail"])
    .nullable()
    .describe("Bucket matching mail goes to, null when the rule does not say"),
  keepOut: z.boolean().describe("True when the rule says to block, ignore or keep out matching mail"),
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
Split the condition: literal facts (sender, domain, receiving account, words the subject contains) go in
match; anything that needs reading the mail to judge (e.g. "failed payments", "security alerts",
"newsletters") goes in semantic, not in subjectKeywords.
The user's accounts: me@personal.example (personal), me@work2.example (work2),
me@work1.example (work1).
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
