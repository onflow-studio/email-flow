import { describe, expect, it, vi } from "vitest";

import { runClassifier, type Evaluator } from "./classify";
import { CONFIRM_TEXT_LIMIT, confirmState, confirmed, type Confirmer, type SecondOpinion } from "./confirm";
import { context, sender } from "./fixtures";
import type { ClassifierAnswer } from "./prompt";
import type { Decision } from "./types";

function evaluator(bucket: ClassifierAnswer["bucket"], overrides: Partial<ClassifierAnswer> = {}): Evaluator {
  const output: ClassifierAnswer = {
    reason: "A receipt.",
    language: "en",
    summary: "September invoice paid.",
    bucket,
    urgency: 1,
    humanWritten: 0.05,
    legitNewSender: null,
    ...overrides,
  };
  return async () => ({ output, modelId: "claude-haiku-4-5-20251001", raw: { output } });
}

// Receipts at 0.8: under its 0.9 threshold, so Claude alone leaves it as a suggestion.
const doubtfulReceipt = evaluator({ inbox: 0.1, news: 0, paper_trail: 0.1, receipts: 0.8 });

function opinion(overrides: Partial<SecondOpinion> = {}): SecondOpinion {
  return { model: "jev-1.13.0", bucket: "receipts", confidence: 0.95, probabilities: { receipts: 0.97 }, ...overrides };
}

const suggestion: Decision = {
  bucket: "receipts",
  source: "ai",
  confidence: 0.8,
  suggested: true,
  promoted: false,
  screener: null,
};

describe("confirmed", () => {
  it("confirms a suggestion when the second opinion agrees with enough confidence", () => {
    expect(confirmed(suggestion, opinion())).toBe(true);
  });

  it("keeps the suggestion when the second opinion picks another bucket", () => {
    expect(confirmed(suggestion, opinion({ bucket: "paper_trail" }))).toBe(false);
  });

  it("keeps the suggestion when the second opinion is unsure", () => {
    expect(confirmed(suggestion, opinion({ confidence: 0.89 }))).toBe(false);
  });

  it("keeps the suggestion without a second opinion", () => {
    expect(confirmed(suggestion, null)).toBe(false);
  });

  it("never touches promotions or triage holds", () => {
    expect(confirmed({ ...suggestion, promoted: true }, opinion())).toBe(false);
    expect(confirmed({ ...suggestion, screener: "triage" }, opinion())).toBe(false);
  });
});

describe("confirmState", () => {
  it("sends sender, subject, the unsubscribe header and the start of the text", () => {
    const ctx = context();
    ctx.thread.text = "a".repeat(CONFIRM_TEXT_LIMIT + 100);
    ctx.thread.headers = { listUnsubscribe: "<mailto:x@y>" };
    expect(confirmState(ctx)).toEqual({
      from: "Vercel <billing@vercel.com>",
      subject: "Your invoice for September",
      has_list_unsubscribe: true,
      body: "a".repeat(CONFIRM_TEXT_LIMIT),
    });
  });
});

describe("runClassifier with a second opinion", () => {
  it("applies a suggestion the second opinion confirms, same bucket", async () => {
    const run = await runClassifier(context(), doubtfulReceipt, async () => opinion());
    expect(run.decision).toMatchObject({ bucket: "receipts", suggested: false, confidence: 0.8 });
    expect(run.model?.raw).toMatchObject({ secondOpinion: opinion() });
  });

  it("leaves the suggestion when the second opinion disagrees, and records it", async () => {
    const run = await runClassifier(context(), doubtfulReceipt, async () => opinion({ bucket: "inbox" }));
    expect(run.decision).toMatchObject({ bucket: "receipts", suggested: true });
    expect(run.model?.raw).toMatchObject({ secondOpinion: { bucket: "inbox" } });
  });

  it("does not ask when Claude is already above threshold", async () => {
    const confirm = vi.fn<Confirmer>(async () => opinion());
    const sure = evaluator({ inbox: 0, news: 0, paper_trail: 0.05, receipts: 0.95 });
    const run = await runClassifier(context(), sure, confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(run.decision.suggested).toBe(false);
  });

  it("does not ask for a new sender held in triage", async () => {
    const confirm = vi.fn<Confirmer>(async () => opinion());
    const run = await runClassifier(
      context({ sender: sender({ decision: "none" }) }),
      evaluator({ inbox: 0.1, news: 0, paper_trail: 0.1, receipts: 0.8 }, { legitNewSender: 0.2 }),
      confirm,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(run.decision.bucket).toBe("triage");
  });

  it("keeps the suggestion when the second opinion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await runClassifier(context(), doubtfulReceipt, async () => {
      throw new Error("Jev returned 529");
    });
    expect(run.decision).toMatchObject({ bucket: "receipts", suggested: true });
  });
});
