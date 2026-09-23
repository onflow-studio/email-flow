import { desc } from "drizzle-orm";
import type { Metadata } from "next";

import type { RuleStructure } from "@/lib/ai/rules";
import { db } from "@/lib/db";
import { rules } from "@/lib/db/schema";

import { RulesSection } from "../rules-section";

export const metadata: Metadata = { title: "rules · settings · superfer" };

export default async function RulesPage() {
  const ruleRows = await db
    .select({ id: rules.id, text: rules.text, enabled: rules.enabled, structured: rules.structured })
    .from(rules)
    .orderBy(desc(rules.enabled), desc(rules.createdAt));
  const parserConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <RulesSection
      parserConfigured={parserConfigured}
      rules={ruleRows.map((r) => ({ ...r, structured: r.structured as RuleStructure | null }))}
    />
  );
}
