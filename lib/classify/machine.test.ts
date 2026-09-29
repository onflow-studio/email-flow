import { describe, expect, it } from "vitest";

import type { JevResponse } from "@/lib/ai/jev";

import { MACHINE_THRESHOLD, machineVerdict } from "./machine";

const answer = (choice: string, confidence: number): JevResponse => ({
  model: "jev-test",
  answers: {
    machine: {
      type: "choice",
      choice,
      confidence,
      probabilities: { machine: choice === "machine" ? confidence : 1 - confidence, person: choice === "person" ? confidence : 1 - confidence },
    },
  },
  usage: { input_tokens: 0, output_tokens: 0 },
});

describe("machineVerdict", () => {
  it("calls a sender a machine only when Jev is confident", () => {
    expect(machineVerdict(answer("machine", 0.95))).toEqual({ machine: true, confidence: 0.95 });
    expect(machineVerdict(answer("machine", MACHINE_THRESHOLD - 0.01)).machine).toBe(false);
  });

  it("keeps people as people, recording the machine probability", () => {
    const v = machineVerdict(answer("person", 0.9));
    expect(v.machine).toBe(false);
    expect(v.confidence).toBeCloseTo(0.1);
  });

  it("throws on an answer it cannot read", () => {
    expect(() => machineVerdict({ ...answer("machine", 0.9), answers: {} })).toThrow();
  });
});
