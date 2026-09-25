import { describe, expect, it, vi } from "vitest";

import { runClassifier, type Evaluator } from "./classify";
import { context, sender } from "./fixtures";
import type { ClassifierAnswer } from "./prompt";
import { evaluateRules, matchesConditions, readRule, type RuleConditions } from "./rules";
import type { ModelBucket, RuleInput, ThreadInput } from "./types";

const saved = new Date("2026-09-01T00:00:00Z");

function rule(structured: Record<string, unknown>, overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: `r-${Math.random()}`,
    text: "rule",
    updatedAt: saved,
    structured: {
      match: { senders: [], domains: [], accounts: [], subjectKeywords: [], ...(structured.match as object) },
      semantic: null,
      bucket: null,
      keepOut: false,
      urgent: null,
      summary: "rule",
      ...structured,
    },
    ...overrides,
  };
}

const vercelLiteral = rule({ match: { domains: ["vercel.com"] }, bucket: "news" });
const vercelPayments = rule({ match: { domains: ["vercel.com"] }, semantic: "failed payments", bucket: "inbox" });
const paymentsAnywhere = rule({ semantic: "failed payments", bucket: "inbox" });

const thread: ThreadInput = context().thread;
const none: RuleConditions = { senders: [], domains: [], accounts: [], subjectKeywords: [] };

function answer(bucket: ModelBucket, urgency = 1): ClassifierAnswer {
  return {
    reason: "test",
    language: "en",
    summary: "test",
    bucket: { inbox: 0.05, news: 0.05, paper_trail: 0.05, receipts: 0.05, [bucket]: 0.9 },
    urgency,
    humanWritten: 0.05,
    legitNewSender: 0.9,
  };
}

function mockModel(output: ClassifierAnswer) {
  return vi.fn<Evaluator>(async () => ({ output, modelId: "claude-haiku-4-5-20251001", raw: { output } }));
}

describe("readRule", () => {
  it("reads literal conditions lowercased, semantic part, and keep out as the out bucket", () => {
    expect(
      readRule({ match: { senders: ["Billing@Vercel.com"], domains: ["@Stripe.com"] }, semantic: " ", keepOut: true, bucket: "news" }),
    ).toEqual({
      conditions: { senders: ["billing@vercel.com"], domains: ["stripe.com"], accounts: [], subjectKeywords: [] },
      semantic: null,
      bucket: "out",
    });
  });

  it("reads receipts as a rule bucket", () => {
    expect(readRule({ match: { domains: ["stripe.com"] }, bucket: "receipts" })?.bucket).toBe("receipts");
  });

  it("tolerates missing or foreign shapes", () => {
    expect(readRule(null)).toBeNull();
    expect(readRule({ domain: "substack.com", bucket: "triage" })).toEqual({ conditions: none, semantic: null, bucket: null });
  });
});

describe("matchesConditions", () => {
  it("requires every non-empty list, any entry within one", () => {
    expect(matchesConditions({ ...none, domains: ["stripe.com", "vercel.com"] }, thread)).toBe(true);
    expect(matchesConditions({ ...none, domains: ["vercel.com"], senders: ["other@vercel.com"] }, thread)).toBe(false);
  });

  it("matches subdomains of a domain, not look-alikes", () => {
    expect(matchesConditions({ ...none, domains: ["vercel.com"] }, { ...thread, fromEmail: "a@mail.vercel.com" })).toBe(true);
    expect(matchesConditions({ ...none, domains: ["vercel.com"] }, { ...thread, fromEmail: "a@notvercel.com" })).toBe(false);
  });

  it("matches the receiving account by email, label, or domain name", () => {
    for (const a of ["me@work1.example", "work1", "work1.example", "work"]) {
      expect(matchesConditions({ ...none, accounts: [a] }, { ...thread, accountLabel: "work" })).toBe(true);
    }
    expect(matchesConditions({ ...none, accounts: ["work2"] }, thread)).toBe(false);
  });

  it("matches subject words case-insensitively", () => {
    expect(matchesConditions({ ...none, subjectKeywords: ["invoice"] }, thread)).toBe(true);
    expect(matchesConditions({ ...none, subjectKeywords: ["refund"] }, thread)).toBe(false);
  });
});

describe("evaluateRules", () => {
  it("literal rule that matches applies directly", () => {
    const r = evaluateRules([vercelLiteral], thread);
    expect(r.direct?.bucket).toBe("news");
    expect(r.conditional).toBeNull();
  });

  it("mixed rule that matches its literal part becomes conditional", () => {
    const r = evaluateRules([vercelPayments], thread);
    expect(r.direct).toBeNull();
    expect(r.conditional?.bucket).toBe("inbox");
    expect(r.hints).toEqual([vercelPayments]);
  });

  it("semantic-only rules and unparsed rules are hints only", () => {
    const unparsed = { text: "anything from my accountant is important", structured: null };
    const r = evaluateRules([paymentsAnywhere, unparsed], thread);
    expect(r).toEqual({ direct: null, conditional: null, hints: [paymentsAnywhere, unparsed] });
  });

  it("rules whose literal part does not match are left out entirely", () => {
    const stripe = rule({ match: { domains: ["stripe.com"] }, bucket: "inbox" });
    expect(evaluateRules([stripe], thread)).toEqual({ direct: null, conditional: null, hints: [] });
  });

  it("a rule without a bucket only hints", () => {
    const r = evaluateRules([rule({ match: { domains: ["vercel.com"] }, urgent: true })], thread);
    expect(r.direct).toBeNull();
    expect(r.hints).toHaveLength(1);
  });

  it("newest matching rule wins", () => {
    const older = rule({ match: { domains: ["vercel.com"] }, bucket: "news" }, { updatedAt: new Date("2026-01-01") });
    const newer = rule({ match: { senders: ["billing@vercel.com"] }, bucket: "paper_trail" });
    expect(evaluateRules([older, newer], thread).direct?.rule).toBe(newer);
  });

  it("a correction for the sender after the rule was saved beats it; an older one does not", () => {
    const after = new Date(saved.getTime() + 1000);
    const before = new Date(saved.getTime() - 1000);
    expect(evaluateRules([vercelLiteral], thread, { senderCorrectedAt: after }).direct).toBeNull();
    expect(evaluateRules([vercelLiteral], thread, { senderCorrectedAt: before }).direct?.bucket).toBe("news");
  });

  it("an unscreened sender is only placed by a rule naming it", () => {
    const bySubject = rule({ match: { subjectKeywords: ["invoice"] }, bucket: "paper_trail" });
    expect(evaluateRules([bySubject], thread, { screening: true }).direct).toBeNull();
    expect(evaluateRules([bySubject], thread).direct?.bucket).toBe("paper_trail");
    expect(evaluateRules([vercelLiteral], thread, { screening: true }).direct?.bucket).toBe("news");
  });
});

describe("runClassifier with rules", () => {
  it("literal rule: applied with source rule, model not called", async () => {
    const model = mockModel(answer("paper_trail"));
    const run = await runClassifier(context({ rules: [vercelLiteral] }), model);
    expect(model).not.toHaveBeenCalled();
    expect(run.model).toBeNull();
    expect(run.decision).toEqual({
      bucket: "news",
      source: "rule",
      confidence: 1,
      suggested: false,
      promoted: false,
      screener: null,
    });
  });

  it("literal keep-out rule sends the thread out", async () => {
    const keepOut = rule({ match: { domains: ["vercel.com"] }, keepOut: true });
    const run = await runClassifier(context({ rules: [keepOut] }), mockModel(answer("news")));
    expect(run.decision).toMatchObject({ bucket: "out", source: "rule" });
  });

  it("literal rule lets an unscreened sender it names in", async () => {
    const run = await runClassifier(
      context({ rules: [vercelLiteral], sender: sender({ decision: "none" }) }),
      mockModel(answer("news")),
    );
    expect(run.decision).toMatchObject({ bucket: "news", source: "rule", screener: "allow" });
  });

  it("mixed rule: the model's top bucket agrees, rule applies", async () => {
    const run = await runClassifier(context({ rules: [vercelPayments] }), mockModel(answer("inbox")));
    expect(run.decision).toMatchObject({ bucket: "inbox", source: "rule" });
    expect(run.model?.result.bucket).toBe("inbox");
  });

  it("mixed rule: the model disagrees but urgency is 4 or more, rule applies", async () => {
    const run = await runClassifier(context({ rules: [vercelPayments] }), mockModel(answer("news", 4)));
    expect(run.decision).toMatchObject({ bucket: "inbox", source: "rule" });
  });

  it("mixed rule: the model disagrees and it is not urgent, normal decision stands", async () => {
    const run = await runClassifier(context({ rules: [vercelPayments] }), mockModel(answer("paper_trail")));
    expect(run.decision).toMatchObject({ bucket: "paper_trail", source: "ai" });
  });

  it("the model only sees rules that could apply", async () => {
    const stripe = rule({ match: { domains: ["stripe.com"] }, semantic: "refunds", bucket: "inbox" });
    const model = mockModel(answer("paper_trail"));
    await runClassifier(context({ rules: [stripe, paymentsAnywhere] }), model);
    const { rules } = JSON.parse(model.mock.calls[0][0].prompt) as { rules: { text: string }[] };
    expect(rules).toEqual([{ text: paymentsAnywhere.text, structured: paymentsAnywhere.structured }]);
  });

  it("a later correction for the sender makes the model decide instead of the rule", async () => {
    const model = mockModel(answer("paper_trail"));
    const run = await runClassifier(
      context({ rules: [vercelLiteral], senderCorrectedAt: new Date(saved.getTime() + 1000) }),
      model,
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(run.decision).toMatchObject({ bucket: "paper_trail", source: "ai" });
  });
});
