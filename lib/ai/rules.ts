import { Output, generateText } from "ai";
import { z } from "zod";

import { claude } from "./index";

// Structured hints for one natural-language rule. Stored in rules.structured next to the text;
// classify hands both to the classifier, so a wrong parse degrades to the plain text, never overrides it.
export const ruleStructureSchema = z.object({
  // Checked literally by lib/classify. Every non-empty list must match for the rule to apply.
  match: z.object({
    senders: z.array(z.string()).describe("Exact sender email addresses, lowercased"),
    fromNames: z
      .array(z.string())
      .describe("Exact sender display names the rule names, lowercased, e.g. linear-code[bot]; not email addresses"),
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
    .enum(["inbox", "news", "paper_trail", "receipts"])
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
- paper_trail: order and shipping updates, routine account notifications
- receipts: receipts, invoices, payment confirmations, refunds, subscription charges
Only fill what the rule states or clearly implies. Leave lists empty and use null rather than guessing.
A company name like "Vercel" means its domain (vercel.com) when the domain is obvious.
Split the condition: literal facts (sender address, sender display name, domain, receiving account, words the subject contains) go in
match; anything that needs reading the mail to judge (e.g. "failed payments", "security alerts",
"newsletters") goes in semantic, not in subjectKeywords.
Rules may be in English or Spanish.`;

/** The user's receiving accounts, so a rule naming one by label or address lands in match.accounts. */
export type RuleAccount = { email: string; label: string };

export async function parseRule(text: string, accounts: RuleAccount[]): Promise<RuleStructure> {
  const owned = accounts.map((a) => `${a.email} (${a.label})`).join(", ");
  const { output } = await generateText({
    model: claude(),
    system: owned ? `${INSTRUCTIONS}\nThe user's accounts: ${owned}.` : INSTRUCTIONS,
    prompt: `Rule: ${text}`,
    output: Output.object({ schema: ruleStructureSchema, name: "rule" }),
  });
  return ruleStructureSchema.parse(output);
}
