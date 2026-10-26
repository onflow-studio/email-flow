import { describe, expect, it } from "vitest";

import {
  aiAllowedSenders,
  allowedTarget,
  bulkJudgedSenders,
  choiceDecision,
  currentChoice,
  inboundSenderIds,
  judgedSenders,
  SENDER_CHOICES,
  type SenderState,
} from "./screener";

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

  it("applies the promotion rule to released receipts", () => {
    expect(allowedTarget(null, { bucket: "receipts", urgency: 4 })).toBe("inbox");
    expect(allowedTarget(null, { bucket: "receipts", urgency: 1 })).toBe("receipts");
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

describe("choiceDecision", () => {
  it("lets the sender in with the picked bucket as its default", () => {
    expect(choiceDecision("news")).toEqual({ decision: "allowed", defaultBucket: "news" });
    expect(choiceDecision("paper_trail")).toEqual({ decision: "allowed", defaultBucket: "paper_trail" });
  });

  it("keeps the sender out without a default bucket", () => {
    expect(choiceDecision("out_spam")).toEqual({ decision: "out_spam", defaultBucket: null });
    expect(choiceDecision("out_not_now")).toEqual({ decision: "out_not_now", defaultBucket: null });
  });
});

describe("currentChoice", () => {
  it("reads back every choice it sets", () => {
    for (const choice of SENDER_CHOICES) {
      const { decision, defaultBucket } = choiceDecision(choice);
      expect(currentChoice(decision, defaultBucket)).toBe(choice);
    }
  });

  it("has no choice while undecided or while the AI picks the bucket", () => {
    expect(currentChoice("none", null)).toBeNull();
    expect(currentChoice("allowed", null)).toBeNull();
  });
});

describe("bulkJudgedSenders", () => {
  it("lists each sender once, with every thread that named it", () => {
    const rows = [
      { id: "t1", senderId: "acme", messages: [{ isInbound: true, senderId: "acme" }] },
      { id: "t2", senderId: "divi", messages: forwarded },
      { id: "t3", senderId: "acme", messages: [{ isInbound: true, senderId: "acme" }] },
    ];
    expect([...bulkJudgedSenders(rows, new Map())]).toEqual([
      ["acme", ["t1", "t3"]],
      ["divi", ["t2"]],
      ["jose", ["t2"]],
    ]);
  });

  it("judges each thread against the states before any decision", () => {
    const states = new Map([["divi", state("none")], ["jose", state("allowed", "user")]]);
    const rows = [{ id: "t1", senderId: "divi", messages: forwarded }];
    expect([...bulkJudgedSenders(rows, states)]).toEqual([["divi", ["t1"]]]);
  });

  it("uses the thread's sender when it has no messages yet", () => {
    expect([...bulkJudgedSenders([{ id: "t1", senderId: "acme", messages: [] }], new Map())]).toEqual([["acme", ["t1"]]]);
  });

  it("skips threads without a sender", () => {
    expect(bulkJudgedSenders([{ id: "t1", senderId: null, messages: [] }], new Map()).size).toBe(0);
  });
});
