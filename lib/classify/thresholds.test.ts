import { describe, expect, it } from "vitest";

import { result, sender } from "./fixtures";
import { BUCKET_THRESHOLDS, LEGIT_SENDER_THRESHOLD, decide, needsScreening } from "./thresholds";

describe("thresholds", () => {
  it("applies the top bucket above its threshold", () => {
    const d = decide(result(), sender());
    expect(d).toMatchObject({ bucket: "paper_trail", source: "ai", suggested: false, confidence: 0.9 });
  });

  it("marks the top bucket as suggested below its threshold", () => {
    const d = decide(
      result({ bucket: "news", bucketProbabilities: { inbox: 0.2, news: 0.8, paper_trail: 0 } }),
      sender(),
    );
    expect(BUCKET_THRESHOLDS.news).toBeGreaterThan(0.8);
    expect(d).toMatchObject({ bucket: "news", suggested: true, confidence: 0.8 });
  });

  it("uses a per-bucket threshold", () => {
    const probs = { inbox: 0.87, news: 0.13, paper_trail: 0 };
    expect(decide(result({ bucket: "inbox", bucketProbabilities: probs }), sender()).suggested).toBe(false);
    const newsProbs = { inbox: 0.13, news: 0.87, paper_trail: 0 };
    expect(decide(result({ bucket: "news", bucketProbabilities: newsProbs }), sender()).suggested).toBe(true);
  });

  it("uses the sender's default bucket when the user set one", () => {
    const d = decide(result({ bucket: "news" }), sender({ defaultBucket: "paper_trail" }));
    expect(d).toMatchObject({ bucket: "paper_trail", source: "user", suggested: false });
  });

  it("keeps out senders out without a model result", () => {
    expect(decide(null, sender({ decision: "out_spam" })).bucket).toBe("out");
    expect(decide(null, sender({ decision: "out_not_now" })).bucket).toBe("out");
  });
});

describe("promotion rule", () => {
  it("promotes urgent paper trail to inbox", () => {
    const d = decide(result({ urgency: 4 }), sender());
    expect(d).toMatchObject({ bucket: "inbox", promoted: true });
  });

  it("does not promote below urgency 4", () => {
    expect(decide(result({ urgency: 3 }), sender()).bucket).toBe("paper_trail");
  });

  it("promotes even when paper trail is the sender's default bucket", () => {
    const d = decide(result({ urgency: 5 }), sender({ defaultBucket: "paper_trail" }));
    expect(d).toMatchObject({ bucket: "inbox", promoted: true, source: "user" });
  });

  it("never promotes news", () => {
    const d = decide(
      result({ bucket: "news", bucketProbabilities: { news: 0.9 }, urgency: 5 }),
      sender(),
    );
    expect(d.bucket).toBe("news");
  });
});

describe("triage gating", () => {
  const unknown = sender({ decision: "none", threadCount: 1 });

  it("holds an unknown sender below the legit threshold", () => {
    const d = decide(result({ legitNewSender: LEGIT_SENDER_THRESHOLD - 0.01 }), unknown);
    expect(d).toMatchObject({ bucket: "triage", source: "ai", screener: "triage" });
  });

  it("holds high-confidence spam in triage, never out", () => {
    const d = decide(result({ bucket: "news", legitNewSender: 0.02 }), unknown);
    expect(d.bucket).toBe("triage");
    expect(d.confidence).toBeCloseTo(0.98);
  });

  it("lets a legit unknown sender through and marks it allowed by AI", () => {
    const d = decide(result({ legitNewSender: 0.9 }), unknown);
    expect(d).toMatchObject({ bucket: "paper_trail", screener: "allow" });
  });

  it("gates before promotion: urgent mail from a doubtful sender stays in triage", () => {
    const d = decide(result({ urgency: 5, legitNewSender: 0.3 }), unknown);
    expect(d.bucket).toBe("triage");
  });

  it("treats a missing legit answer as not legit", () => {
    expect(decide(result({ legitNewSender: null }), unknown).bucket).toBe("triage");
  });

  it("skips screening when the user has written to the sender or started the thread", () => {
    const wrote = sender({ decision: "none", userHasWrittenTo: true });
    const started = sender({ decision: "none", userStartedThread: true });
    expect(needsScreening(wrote)).toBe(false);
    expect(needsScreening(started)).toBe(false);
    expect(decide(result({ legitNewSender: null }), wrote)).toMatchObject({
      bucket: "paper_trail",
      screener: "allow",
    });
  });

  it("does not gate senders the user already allowed", () => {
    expect(needsScreening(sender())).toBe(false);
    expect(decide(result(), sender()).screener).toBeNull();
  });
});
