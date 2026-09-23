import { describe, expect, it, vi } from "vitest";

import { runClassifier, type Evaluator } from "./classify";
import { context, sender } from "./fixtures";
import { TEXT_LIMIT, buildJevRequest, parseJevAnswers, type JevAnswer } from "./prompt";

type Email = {
  text: string;
  subject: string;
  headers: Record<string, unknown>;
  from: { domain: string };
};

function answers(overrides: Record<string, JevAnswer> = {}): Record<string, JevAnswer> {
  return {
    bucket: { type: "choice", choice: "paper_trail", probabilities: { inbox: 0.1, news: 0.02, paper_trail: 0.88 } },
    urgency: { type: "score", score: 0.2 },
    humanWritten: { type: "noul", noul: 0.05 },
    ...overrides,
  };
}

function mockJev(a: Record<string, JevAnswer>) {
  return vi.fn<Evaluator>(async () => ({
    answers: a,
    response: { modelId: "jev-1.13.0" },
  }));
}

describe("buildJevRequest", () => {
  it("sends subject, headers, sender facts and the first 2k chars of text", () => {
    const long = "a".repeat(TEXT_LIMIT + 500);
    const ctx = context({
      thread: {
        ...context().thread,
        text: long,
        headers: { listUnsubscribe: "<mailto:x>", precedence: "bulk", inReplyTo: "<id>" },
      },
    });
    const { state } = buildJevRequest(ctx);
    const email = state.email as Email;
    expect(email.text).toHaveLength(TEXT_LIMIT);
    expect(email.subject).toBe("Your invoice for September");
    expect(email.from.domain).toBe("vercel.com");
    expect(email.headers).toEqual({
      hasListUnsubscribe: true,
      precedence: "bulk",
      autoSubmitted: null,
      isReply: true,
    });
    expect(state.sender).toMatchObject({ screenerDecision: "allowed", threadsFromSender: 4 });
  });

  it("asks bucket, urgency and human written, and legit only for unknown senders", () => {
    const known = buildJevRequest(context());
    expect(Object.keys(known.questions)).toEqual(["bucket", "urgency", "humanWritten"]);
    expect(known.questions.bucket).toMatchObject({ type: "choice" });
    expect(Object.keys((known.questions.bucket as { criteria: object }).criteria)).toEqual([
      "inbox",
      "news",
      "paper_trail",
    ]);
    expect(known.questions.urgency).toMatchObject({ type: "score", criteria: expect.any(Array) });
    expect(known.questions.urgency).toMatchObject({ criteria: ["1", "2", "3", "4", "5"] });

    const unknown = buildJevRequest(context({ sender: sender({ decision: "none" }) }));
    expect(unknown.questions.legitNewSender).toMatchObject({ type: "noul" });
  });

  it("includes enabled rules and exemplars", () => {
    const { state } = buildJevRequest(
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
    );
    expect(state.rules).toEqual([
      { text: "Vercel failed payments go to Inbox" },
      { text: "Substack goes to News", structured: { domain: "substack.com", bucket: "news" } },
    ]);
    expect(state.examples).toEqual([
      { from: "billing@vercel.com", subject: "Payment failed", classifiedAs: "paper_trail", userMovedTo: "inbox" },
    ]);
  });
});

describe("parseJevAnswers", () => {
  const legend = { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" };

  it("maps the 0-indexed urgency score to the 1-5 level through the legend", () => {
    const urgency = (score: number) => parseJevAnswers(answers({ urgency: { type: "score", score, legend } })).urgency;
    expect(urgency(0)).toBe(1);
    expect(urgency(2.6)).toBe(4);
    expect(urgency(3.09)).toBe(4);
    expect(urgency(4)).toBe(5);
  });

  it("falls back to the index when the legend is missing", () => {
    expect(parseJevAnswers(answers({ urgency: { type: "score", score: 1.4 } })).urgency).toBe(2);
  });

  it("rejects a legend level outside 1-5", () => {
    expect(() =>
      parseJevAnswers(answers({ urgency: { type: "score", score: 0, legend: { "0": "low" } } })),
    ).toThrow(/legend/);
  });

  it("reads noul answers as probabilities", () => {
    const r = parseJevAnswers(answers({ legitNewSender: { type: "noul", noul: 0.7 } }));
    expect(r.humanWritten).toBe(0.05);
    expect(r.legitNewSender).toBe(0.7);
  });

  it("fills missing probabilities from the choice", () => {
    const r = parseJevAnswers(answers({ bucket: { type: "choice", choice: "news" } }));
    expect(r.bucketProbabilities).toEqual({ inbox: 0, news: 1, paper_trail: 0 });
  });

  it("rejects a bucket outside the model buckets", () => {
    expect(() => parseJevAnswers(answers({ bucket: { type: "choice", choice: "triage" } }))).toThrow();
  });
});

describe("runClassifier with Jev mocked", () => {
  it("makes one call with the built request and returns the decision", async () => {
    const jev = mockJev(answers());
    const ctx = context();
    const run = await runClassifier(ctx, jev);
    expect(jev).toHaveBeenCalledTimes(1);
    expect(jev.mock.calls[0]).toEqual([buildJevRequest(ctx).state, buildJevRequest(ctx).questions]);
    expect(run.decision).toMatchObject({ bucket: "paper_trail", source: "ai", suggested: false });
    expect(run.model?.id).toBe("jev-1.13.0");
    expect(run.model?.raw).toMatchObject({ answers: answers() });
  });

  it("promotes a failed payment to inbox", async () => {
    const run = await runClassifier(context(), mockJev(answers({ urgency: { type: "score", score: 3.2 } })));
    expect(run.decision).toMatchObject({ bucket: "inbox", promoted: true });
  });

  it("sends a doubtful new sender to triage", async () => {
    const jev = mockJev(answers({ legitNewSender: { type: "noul", noul: 0.2 } }));
    const run = await runClassifier(context({ sender: sender({ decision: "none" }) }), jev);
    expect(run.decision.bucket).toBe("triage");
    expect(run.model?.result.legitNewSender).toBe(0.2);
  });

  it("does not call Jev for a sender the user kept out", async () => {
    const jev = mockJev(answers());
    const run = await runClassifier(context({ sender: sender({ decision: "out_spam" }) }), jev);
    expect(jev).not.toHaveBeenCalled();
    expect(run).toEqual({ decision: expect.objectContaining({ bucket: "out" }), model: null });
  });
});
