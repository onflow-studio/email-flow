import { createAnthropic } from "@ai-sdk/anthropic";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import {
  experimental_evaluate as evaluate,
  type Experimental_EvaluationQuestion as EvaluationQuestion,
  type Experimental_EvaluationResult as EvaluationResult,
} from "ai";

export type { EvaluationQuestion, EvaluationResult };

// Shared state handed to Jev. Plain JSON only.
export type JevState = { [key: string]: unknown };

export const JEV_MODEL = "jev-latest";
export const CLAUDE_MODEL = "claude-sonnet-5";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Created on first use so importing this module never needs keys (build, tests).
let jevProvider: ReturnType<typeof createTypeSafeAi> | undefined;
let anthropicProvider: ReturnType<typeof createAnthropic> | undefined;

function jev() {
  jevProvider ??= createTypeSafeAi({ apiKey: requireEnv("JEV_API_KEY") });
  return jevProvider;
}

export function claude(modelId: string = CLAUDE_MODEL) {
  anthropicProvider ??= createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return anthropicProvider(modelId);
}

// One Jev call: typed questions against one shared state, calibrated answers back.
export async function evaluateWithJev<const Q extends Record<string, EvaluationQuestion>>(
  state: JevState,
  questions: Q,
): Promise<EvaluationResult<Q>> {
  return evaluate({
    model: jev().evaluationModel(JEV_MODEL),
    state: state as Parameters<typeof evaluate>[0]["state"],
    questions,
  });
}
