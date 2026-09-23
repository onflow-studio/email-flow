import { describe, expect, it } from "vitest";

import { participationPlan, type ParticipationInput } from "./participation";
import type { SenderState } from "./screener";

const undecided: SenderState = { decision: "none", decidedBy: null };
const byUser: SenderState = { decision: "allowed", decidedBy: "user" };
const byAi: SenderState = { decision: "allowed", decidedBy: "ai" };
const keptOut: SenderState = { decision: "out_spam", decidedBy: "user" };

// A newsletter the user forwarded to a colleague, who answered.
const forwarded: ParticipationInput["messages"] = [
  { isInbound: true, senderId: "divi" },
  { isInbound: false, senderId: null },
  { isInbound: true, senderId: "jose" },
];

function input(overrides: Partial<ParticipationInput> = {}): ParticipationInput {
  return {
    bucket: "triage",
    spam: false,
    threadSenderId: "divi",
    messages: forwarded,
    states: new Map([
      ["divi", undecided],
      ["jose", undecided],
    ]),
    reverted: new Set(),
    ...overrides,
  };
}

describe("participationPlan", () => {
  it("lets in every undecided sender, the first one included, and takes the thread out of triage", () => {
    expect(participationPlan(input())).toEqual({ letIn: ["divi", "jose"], release: true });
  });

  it("does nothing in a thread the user never wrote in", () => {
    const messages = [forwarded[0], forwarded[2]];
    expect(participationPlan(input({ messages }))).toEqual({ letIn: [], release: false });
  });

  it("lets in senders who wrote before the user as well as after", () => {
    const messages = [forwarded[0], forwarded[2], { isInbound: false, senderId: null }];
    expect(participationPlan(input({ messages })).letIn).toEqual(["divi", "jose"]);
  });

  it("keeps every existing decision", () => {
    const states = new Map([
      ["divi", keptOut],
      ["jose", byUser],
    ]);
    expect(participationPlan(input({ bucket: "out", states }))).toEqual({ letIn: [], release: false });
  });

  it("releases a held thread whose first sender is already allowed", () => {
    const states = new Map([
      ["divi", byAi],
      ["jose", byUser],
    ]);
    expect(participationPlan(input({ states }))).toEqual({ letIn: [], release: true });
  });

  it("only moves threads out of triage, never between other buckets", () => {
    expect(participationPlan(input({ bucket: "news" }))).toEqual({ letIn: ["divi", "jose"], release: false });
  });

  it("respects an AI let-in the user took back: that sender stays undecided and the thread stays", () => {
    expect(participationPlan(input({ reverted: new Set(["divi", "jose"]) }))).toEqual({ letIn: [], release: false });
  });

  it("still lets in the others when only the first sender was taken back, but holds the thread", () => {
    expect(participationPlan(input({ reverted: new Set(["divi"]) }))).toEqual({ letIn: ["jose"], release: false });
  });

  it("ignores spam", () => {
    expect(participationPlan(input({ spam: true }))).toEqual({ letIn: [], release: false });
  });

  it("treats a sender with no row yet as undecided", () => {
    expect(participationPlan(input({ states: new Map() })).letIn).toEqual(["divi", "jose"]);
  });
});
