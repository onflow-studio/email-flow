import { askJev, jevConfigured, type JevChoice, type JevChoiceAnswer } from "@/lib/ai/jev";

import { MODEL_BUCKETS, type ClassifyContext, type Decision, type ModelBucket } from "./types";

// A second model's read on the bucket. Claude's probabilities are self-reported, so a suggestion
// only turns into a placement when a calibrated model independently picks the same bucket.
export const CONFIRM_THRESHOLD = 0.9;
export const CONFIRM_TEXT_LIMIT = 1500;

export type SecondOpinion = {
  model: string;
  bucket: ModelBucket;
  confidence: number;
  probabilities: Record<string, number>;
};

// Null when there is no second opinion to be had (no key); errors throw.
export type Confirmer = (ctx: ClassifyContext) => Promise<SecondOpinion | null>;

// Validated against production history on 2026-09-29: auto-applied 29% of suggested threads,
// one wrong out of 18 user corrections. Change the wording and that result no longer holds.
export const BUCKET_QUESTION: JevChoice = {
  type: "choice",
  instructions: "Which bucket should this email go in for the person who received it?",
  criteria: {
    inbox:
      "Mail the person should see: written by a real person, a reply, anything needing their action or attention, or an urgent service notice such as a failed payment or security alert",
    news: "Newsletters, digests, announcements, promotions and marketing, things to read later",
    paper_trail:
      "Order and shipping updates, routine account and transactional notifications, and automated notifications from developer tools (GitHub, CI runs, Linear, monitoring) kept for the record, not about money changing hands",
    receipts:
      "Money that moved: receipts, invoices, payment confirmations, refunds, subscription or renewal charges. Not failed payments.",
  },
};

export function confirmState(ctx: ClassifyContext) {
  const { thread } = ctx;
  return {
    from: `${thread.fromName ?? ""} <${thread.fromEmail}>`,
    subject: thread.subject ?? "",
    has_list_unsubscribe: Boolean(thread.headers.listUnsubscribe),
    body: thread.text.slice(0, CONFIRM_TEXT_LIMIT),
  };
}

function parseOpinion(model: string, answer: JevChoiceAnswer | undefined): SecondOpinion {
  if (!answer || !(MODEL_BUCKETS as readonly string[]).includes(answer.choice)) {
    throw new Error(`Jev returned no usable bucket: ${JSON.stringify(answer)}`);
  }
  return {
    model,
    bucket: answer.choice as ModelBucket,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
}

export const jevConfirmer: Confirmer = async (ctx) => {
  if (!jevConfigured()) return null;
  const response = await askJev(confirmState(ctx), { bucket: BUCKET_QUESTION });
  return parseOpinion(response.model, response.answers.bucket);
};

// Only an AI suggestion can be confirmed. The bucket never changes: agreement just drops the note.
export function needsConfirmation(decision: Decision) {
  return decision.source === "ai" && decision.suggested && !decision.promoted && decision.screener !== "triage";
}

export function confirmed(decision: Decision, opinion: SecondOpinion | null) {
  return (
    needsConfirmation(decision) &&
    opinion !== null &&
    opinion.bucket === decision.bucket &&
    opinion.confidence >= CONFIRM_THRESHOLD
  );
}
