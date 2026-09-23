import type { Decision, ModelBucket, ModelResult, SenderFacts } from "./types";

// Starting points. Above: applied. Below: applied but shown as a suggestion.
// Set a notch higher than for a calibrated classifier: Claude's self-reported probabilities run
// overconfident. Tune against corrections once there is enough history.
export const BUCKET_THRESHOLDS: Record<ModelBucket, number> = {
  inbox: 0.85,
  news: 0.9,
  paper_trail: 0.9,
};

// Unknown senders below this go to triage.
export const LEGIT_SENDER_THRESHOLD = 0.8;

// Urgency 1-5. At or above this, paper trail goes to inbox (failed payments, security alerts).
export const PROMOTE_URGENCY = 4;

// The user has written to them or started the thread: no screening needed.
export function knownByContact(sender: SenderFacts) {
  return sender.userHasWrittenTo || sender.userStartedThread;
}

// Screener still needs to judge this sender.
export function needsScreening(sender: SenderFacts) {
  return sender.decision === "none" && !knownByContact(sender);
}

// Null result means the model was not called (sender already kept out).
export function decide(result: ModelResult | null, sender: SenderFacts): Decision {
  if (sender.decision === "out_spam" || sender.decision === "out_not_now") {
    return {
      bucket: "out",
      source: "user",
      confidence: 1,
      suggested: false,
      promoted: false,
      screener: null,
    };
  }
  if (!result) throw new Error("Model result required for a sender that is not kept out");

  const confidence = result.bucketProbabilities[result.bucket] ?? 0;
  let decision: Decision;
  if (sender.decision === "allowed" && sender.defaultBucket) {
    decision = {
      bucket: sender.defaultBucket,
      source: "user",
      confidence: 1,
      suggested: false,
      promoted: false,
      screener: null,
    };
  } else {
    decision = {
      bucket: result.bucket,
      source: "ai",
      confidence,
      suggested: confidence < BUCKET_THRESHOLDS[result.bucket],
      promoted: false,
      screener: null,
    };
  }

  if (decision.bucket === "paper_trail" && result.urgency >= PROMOTE_URGENCY) {
    decision = { ...decision, bucket: "inbox", promoted: true };
  }

  if (sender.decision === "none") {
    if (knownByContact(sender)) return { ...decision, screener: "allow" };
    const legit = result.legitNewSender ?? 0;
    if (legit < LEGIT_SENDER_THRESHOLD) {
      return {
        bucket: "triage",
        source: "ai",
        confidence: 1 - legit,
        suggested: false,
        promoted: false,
        screener: "triage",
      };
    }
    return { ...decision, screener: "allow" };
  }

  return decision;
}
