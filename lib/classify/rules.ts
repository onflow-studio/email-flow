import type { Bucket } from "@/lib/db/schema";

import { MODEL_BUCKETS, type Decision, type ModelBucket, type ModelResult, type RuleInput, type SenderFacts, type ThreadInput } from "./types";

// Hybrid rules. A rule's literal conditions (sender, domain, account, subject words) are matched
// here; its semantic part ("failed payments") is judged by the model.
// - literal only, all conditions match: the rule bucket applies directly, the model is not asked
// - literal plus semantic, literal part matches: the model decides; the rule bucket applies when its
//   top bucket agrees or urgency is high
// - semantic only, or no bucket: a hint in the model's prompt, nothing more
// A user correction for the sender made after the rule was last saved beats the rule, and an
// unscreened sender is only placed by a rule that names it (sender or domain).

export const RULE_URGENCY = 4;

export type RuleConditions = {
  senders: string[];
  domains: string[];
  accounts: string[];
  subjectKeywords: string[];
};

export type ReadRule = {
  conditions: RuleConditions;
  semantic: string | null;
  bucket: Bucket | null;
};

export type RuleHit = { rule: RuleInput; bucket: Bucket };

export type RuleEvaluation = {
  // Literal rule that matched: apply without asking the model.
  direct: RuleHit | null;
  // Mixed rule whose literal part matched: apply if the model agrees.
  conditional: RuleHit | null;
  // What the model sees: semantic-only rules and rules whose literal part matched.
  hints: RuleInput[];
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim().toLowerCase())
    : [];
}

// Stored JSON comes from the parser, possibly an older shape; read it defensively.
export function readRule(structured: unknown): ReadRule | null {
  if (!structured || typeof structured !== "object") return null;
  const s = structured as Record<string, unknown>;
  const match = (s.match ?? {}) as Record<string, unknown>;
  const bucket =
    s.keepOut === true
      ? "out"
      : MODEL_BUCKETS.includes(s.bucket as ModelBucket)
        ? (s.bucket as ModelBucket)
        : null;
  return {
    conditions: {
      senders: strings(match.senders),
      domains: strings(match.domains).map((d) => d.replace(/^@/, "")),
      accounts: strings(match.accounts),
      subjectKeywords: strings(match.subjectKeywords),
    },
    semantic: typeof s.semantic === "string" && s.semantic.trim() ? s.semantic.trim() : null,
    bucket,
  };
}

export function hasLiteralConditions(c: RuleConditions): boolean {
  return c.senders.length + c.domains.length + c.accounts.length + c.subjectKeywords.length > 0;
}

function domainOf(email: string) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

// Every non-empty condition list must match; within a list, any entry may.
export function matchesConditions(
  c: RuleConditions,
  thread: Pick<ThreadInput, "fromEmail" | "accountEmail" | "accountLabel" | "subject">,
): boolean {
  const from = thread.fromEmail.toLowerCase();
  const fromDomain = domainOf(from);
  const account = thread.accountEmail.toLowerCase();
  const label = thread.accountLabel?.toLowerCase() ?? null;
  const subject = (thread.subject ?? "").toLowerCase();

  if (c.senders.length && !c.senders.includes(from)) return false;
  if (c.domains.length && !c.domains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`))) {
    return false;
  }
  if (
    c.accounts.length &&
    !c.accounts.some((a) => a === account || a === label || a === domainOf(account) || a === domainOf(account).split(".")[0])
  ) {
    return false;
  }
  if (c.subjectKeywords.length && !c.subjectKeywords.some((k) => subject.includes(k))) return false;
  return true;
}

function savedAt(rule: RuleInput) {
  return rule.updatedAt?.getTime() ?? 0;
}

export function evaluateRules(
  rules: RuleInput[],
  thread: Pick<ThreadInput, "fromEmail" | "accountEmail" | "accountLabel" | "subject">,
  {
    senderCorrectedAt = null,
    screening = false,
  }: {
    senderCorrectedAt?: Date | null;
    // Unknown sender the screener still has to judge: only a rule naming the sender may place it.
    screening?: boolean;
  } = {},
): RuleEvaluation {
  const hints: RuleInput[] = [];
  const direct: RuleHit[] = [];
  const conditional: RuleHit[] = [];

  for (const rule of rules) {
    const read = readRule(rule.structured);
    if (!read || !hasLiteralConditions(read.conditions)) {
      hints.push(rule);
      continue;
    }
    if (!matchesConditions(read.conditions, thread)) continue;
    hints.push(rule);
    if (!read.bucket) continue;
    if (senderCorrectedAt && senderCorrectedAt.getTime() > savedAt(rule)) continue;
    if (screening && !read.conditions.senders.length && !read.conditions.domains.length) continue;
    (read.semantic ? conditional : direct).push({ rule, bucket: read.bucket });
  }

  // Newest rule wins when several match.
  const newest = (hits: RuleHit[]) => hits.sort((a, b) => savedAt(b.rule) - savedAt(a.rule))[0] ?? null;
  return { direct: newest(direct), conditional: newest(conditional), hints };
}

// The model agreed with a mixed rule: its top bucket is the rule's, or the mail is urgent.
export function modelConfirms(hit: RuleHit, result: ModelResult): boolean {
  return result.bucket === hit.bucket || result.urgency >= RULE_URGENCY;
}

export function ruleDecision(bucket: Bucket, sender: SenderFacts): Decision {
  return {
    bucket,
    source: "rule",
    confidence: 1,
    suggested: false,
    promoted: false,
    // Only rules naming the sender reach an unscreened one; that is the user letting it in.
    screener: sender.decision === "none" && bucket !== "out" ? "allow" : null,
  };
}
