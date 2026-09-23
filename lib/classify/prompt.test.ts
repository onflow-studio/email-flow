import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { claudeEvaluator, runClassifier } from "./classify";
import { context, sender } from "./fixtures";
import {
  SYSTEM_PROMPT,
  TEXT_LIMIT,
  buildClassifierRequest,
  parseAnswer,
  type ClassifierAnswer,
} from "./prompt";

type Input = {
  screening: boolean;
  email: { text: string; subject: string; headers: Record<string, unknown>; from: { domain: string } };
  sender: Record<string, unknown>;
  rules: unknown[];
  examples: unknown[];
};

const input = (prompt: string) => JSON.parse(prompt) as Input;

function answer(overrides: Partial<ClassifierAnswer> = {}): ClassifierAnswer {
  return {
    reason: "An invoice from Vercel.",
    bucket: { inbox: 0.04, news: 0.01, paper_trail: 0.95 },
    urgency: 1,
    humanWritten: 0.05,
    legitNewSender: null,
    ...overrides,
  };
}

// A model that answers with the given text, as Claude would through structured output.
function mockModel(reply: ClassifierAnswer | string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 60, text: 60, reasoning: undefined },
      },
      response: { modelId: "claude-haiku-4-5-20251001" },
      warnings: [],
    }),
  });
}

describe("buildClassifierRequest", () => {
  it("sends subject, headers, sender facts and the first 2k chars of text", () => {
    const long = "a".repeat(TEXT_LIMIT + 500);
    const ctx = context({
      thread: {
        ...context().thread,
        text: long,
        headers: { listUnsubscribe: "<mailto:x>", precedence: "bulk", inReplyTo: "<id>" },
      },
    });
    const { email, sender: facts } = input(buildClassifierRequest(ctx).prompt);
    expect(email.text).toHaveLength(TEXT_LIMIT);
    expect(email.subject).toBe("Your invoice for September");
    expect(email.from.domain).toBe("vercel.com");
    expect(email.headers).toEqual({
      hasListUnsubscribe: true,
      precedence: "bulk",
      autoSubmitted: null,
      isReply: true,
    });
    expect(facts).toMatchObject({ screenerDecision: "allowed", threadsFromSender: 4 });
  });

  it("keeps the system prompt identical across threads so it caches", () => {
    const a = buildClassifierRequest(context());
    const b = buildClassifierRequest(context({ sender: sender({ decision: "none" }), rules: [{ text: "x", structured: null }] }));
    expect(a.system).toBe(SYSTEM_PROMPT);
    expect(b.system).toBe(SYSTEM_PROMPT);
    expect(a.prompt).not.toBe(b.prompt);
  });

  it("asks for a legit sender judgement only for unknown senders", () => {
    expect(input(buildClassifierRequest(context()).prompt).screening).toBe(false);
    expect(input(buildClassifierRequest(context({ sender: sender({ decision: "none" }) })).prompt).screening).toBe(true);
    const contacted = sender({ decision: "none", userHasWrittenTo: true });
    expect(input(buildClassifierRequest(context({ sender: contacted })).prompt).screening).toBe(false);
  });

  it("includes enabled rules and exemplars", () => {
    const { rules, examples } = input(
      buildClassifierRequest(
        context({
          rules: [
            { text: "Vercel failed payments go to Inbox", structured: null },
            { text: "Substack goes to News", structured: { domain: "substack.com", bucket: "news" } },
          ],
          exemplars: [
            {
              id: "c1",
              senderEmail: "billing@vercel.com",
              domain: "vercel.com",
              subject: "Payment failed",
              fromBucket: "paper_trail",
              toBucket: "inbox",
              createdAt: new Date(),
            },
          ],
        }),
      ).prompt,
    );
    expect(rules).toEqual([
      { text: "Vercel failed payments go to Inbox" },
      { text: "Substack goes to News", structured: { domain: "substack.com", bucket: "news" } },
    ]);
    expect(examples).toEqual([
      { from: "billing@vercel.com", subject: "Payment failed", classifiedAs: "paper_trail", userMovedTo: "inbox" },
    ]);
  });
});

describe("parseAnswer", () => {
  it("picks the top bucket and normalizes probabilities to sum to 1", () => {
    const r = parseAnswer(answer({ bucket: { inbox: 0.2, news: 0.6, paper_trail: 0.2 } }), false);
    expect(r.bucket).toBe("news");
    expect(r.bucketProbabilities).toEqual({ inbox: 0.2, news: 0.6, paper_trail: 0.2 });

    const off = parseAnswer(answer({ bucket: { inbox: 0.25, news: 0, paper_trail: 1 } }), false);
    expect(off.bucket).toBe("paper_trail");
    expect(off.bucketProbabilities).toEqual({ inbox: 0.2, news: 0, paper_trail: 0.8 });
  });

  it("rejects probabilities outside 0-1 and all-zero buckets", () => {
    expect(() => parseAnswer(answer({ bucket: { inbox: -0.1, news: 0.5, paper_trail: 0.6 } }), false)).toThrow(/0-1/);
    expect(() => parseAnswer(answer({ bucket: { inbox: 0, news: 0, paper_trail: 0 } }), false)).toThrow(/all-zero/);
    expect(() => parseAnswer(answer({ humanWritten: 1.2 }), false)).toThrow(/humanWritten/);
  });

  it("rejects urgency outside 1-5", () => {
    expect(() => parseAnswer(answer({ urgency: 0 }), false)).toThrow(/urgency/);
    expect(() => parseAnswer(answer({ urgency: 6 }), false)).toThrow(/urgency/);
    expect(parseAnswer(answer({ urgency: 4 }), false).urgency).toBe(4);
  });

  it("requires legitNewSender when screening, and drops it otherwise", () => {
    expect(() => parseAnswer(answer(), true)).toThrow(/legitNewSender/);
    expect(parseAnswer(answer({ legitNewSender: 0.7 }), true).legitNewSender).toBe(0.7);
    expect(parseAnswer(answer({ legitNewSender: 0.7 }), false).legitNewSender).toBeNull();
  });
});

describe("runClassifier with the model mocked", () => {
  it("makes one call with the built request and returns the decision", async () => {
    const model = mockModel(answer());
    const ctx = context();
    const run = await runClassifier(ctx, claudeEvaluator(model));

    expect(model.doGenerateCalls).toHaveLength(1);
    const { prompt } = model.doGenerateCalls[0];
    const expected = buildClassifierRequest(ctx);
    expect(prompt[0]).toMatchObject({
      role: "system",
      content: expected.system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    expect(prompt[1]).toMatchObject({ role: "user", content: [{ type: "text", text: expected.prompt }] });

    expect(run.decision).toMatchObject({ bucket: "paper_trail", source: "ai", suggested: false });
    expect(run.model?.id).toBe("claude-haiku-4-5-20251001");
    expect(run.model?.raw).toMatchObject({ output: answer() });
  });

  it("promotes a failed payment to inbox", async () => {
    const run = await runClassifier(context(), claudeEvaluator(mockModel(answer({ urgency: 4 }))));
    expect(run.decision).toMatchObject({ bucket: "inbox", promoted: true });
  });

  it("sends a doubtful new sender to triage", async () => {
    const run = await runClassifier(
      context({ sender: sender({ decision: "none" }) }),
      claudeEvaluator(mockModel(answer({ legitNewSender: 0.2 }))),
    );
    expect(run.decision.bucket).toBe("triage");
    expect(run.model?.result.legitNewSender).toBe(0.2);
  });

  it("does not call the model for a sender the user kept out", async () => {
    const evaluate = vi.fn(claudeEvaluator(mockModel(answer())));
    const run = await runClassifier(context({ sender: sender({ decision: "out_spam" }) }), evaluate);
    expect(evaluate).not.toHaveBeenCalled();
    expect(run).toEqual({ decision: expect.objectContaining({ bucket: "out" }), model: null });
  });

  it("throws on a reply that does not match the schema", async () => {
    await expect(runClassifier(context(), claudeEvaluator(mockModel('{"bucket":"inbox"}')))).rejects.toThrow();
  });

  it("throws on a 429 without retrying, so the job runner backs off", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "rate_limit_error",
          url: "https://api.anthropic.com/v1/messages",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      },
    });
    await expect(runClassifier(context(), claudeEvaluator(model))).rejects.toMatchObject({ statusCode: 429 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
