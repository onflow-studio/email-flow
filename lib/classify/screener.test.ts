import { describe, expect, it } from "vitest";

import { aiAllowedSenders, allowedTarget, inboundSenderIds, judgedSenders, type SenderState } from "./screener";

describe("allowedTarget", () => {
  it("uses the default bucket the user picked", () => {
    expect(allowedTarget("news", { bucket: "inbox", urgency: 1 })).toBe("news");
  });

  it("falls back to the model's last choice", () => {
    expect(allowedTarget(null, { bucket: "paper_trail", urgency: 2 })).toBe("paper_trail");
  });

  it("applies the promotion rule to released paper trail", () => {
    expect(allowedTarget(null, { bucket: "paper_trail", urgency: 4 })).toBe("inbox");
  });

  it("defaults to inbox when never classified", () => {
    expect(allowedTarget(null, undefined)).toBe("inbox");
  });
});

const state = (decision: SenderState["decision"], decidedBy: SenderState["decidedBy"] = null): SenderState => ({ decision, decidedBy });

// A newsletter the user forwarded to a colleague, who answered.
const forwarded = [
  { isInbound: true, senderId: "divi" },
  { isInbound: false, senderId: null },
  { isInbound: true, senderId: "jose" },
  { isInbound: true, senderId: "divi" },
];

describe("inboundSenderIds", () => {
  it("lists inbound senders once each, in message order", () => {
    expect(inboundSenderIds(forwarded)).toEqual(["divi", "jose"]);
  });
});

describe("judgedSenders", () => {
  it("judges every undecided sender of a multi-sender thread at once", () => {
    const states = new Map([["divi", state("none")], ["jose", state("none")]]);
    expect(judgedSenders(["divi", "jose"], states, "divi")).toEqual(["divi", "jose"]);
  });

  it("leaves senders who already have a decision alone", () => {
    const states = new Map([["divi", state("none")], ["jose", state("allowed", "user")]]);
    expect(judgedSenders(["divi", "jose"], states, "divi")).toEqual(["divi"]);
  });

  it("treats a sender with no row yet as undecided", () => {
    expect(judgedSenders(["divi"], new Map(), "divi")).toEqual(["divi"]);
  });

  it("falls back to the thread's own sender when nobody is undecided", () => {
    const states = new Map([["divi", state("allowed", "ai")], ["jose", state("out_spam", "user")]]);
    expect(judgedSenders(["divi", "jose"], states, "divi")).toEqual(["divi"]);
  });

  it("has nobody to judge without a sender", () => {
    expect(judgedSenders([], new Map(), null)).toEqual([]);
  });
});

describe("aiAllowedSenders", () => {
  it("picks the senders the AI let in, not the user's", () => {
    const states = new Map([["divi", state("allowed", "ai")], ["jose", state("allowed", "user")], ["x", state("none")]]);
    expect(aiAllowedSenders(["divi", "jose", "x"], states)).toEqual(["divi"]);
  });
});
