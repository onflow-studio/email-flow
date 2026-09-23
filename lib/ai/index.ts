import { createAnthropic } from "@ai-sdk/anthropic";
import { Output, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

export const CLAUDE_MODEL = "claude-sonnet-5";
export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Created on first use so importing this module never needs keys (build, tests).
let anthropicProvider: ReturnType<typeof createAnthropic> | undefined;

export function claude(modelId: string = CLAUDE_MODEL) {
  anthropicProvider ??= createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return anthropicProvider(modelId);
}

export type StructuredRequest<T> = {
  // Stable across calls so the prefix can be cached; per-call data goes in prompt.
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  name: string;
};

export type StructuredResponse<T> = {
  output: T;
  modelId: string;
  raw: unknown;
};

// One structured Claude call. No SDK retries: errors and 429s throw so the job runner retries with backoff.
export async function generateStructured<T>(
  request: StructuredRequest<T>,
  options: { model?: LanguageModel } = {},
): Promise<StructuredResponse<T>> {
  const result = await generateText({
    model: options.model ?? claude(CLASSIFY_MODEL),
    maxRetries: 0,
    instructions: {
      role: "system",
      content: request.system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    prompt: request.prompt,
    output: Output.object({ schema: request.schema, name: request.name }),
  });
  return {
    output: result.output,
    modelId: result.response.modelId,
    raw: { output: result.output, usage: result.usage, finishReason: result.finishReason },
  };
}
