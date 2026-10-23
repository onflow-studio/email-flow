import { createAnthropic } from "@ai-sdk/anthropic";
import { Output, createGateway, embedMany, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

export const CLAUDE_MODEL = "claude-sonnet-5";
export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
export type Embedder = (texts: string[]) => Promise<number[][]>;

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

export function embeddingsEnabled() {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

let gatewayProvider: ReturnType<typeof createGateway> | undefined;

export const embedTexts: Embedder = async (texts) => {
  if (texts.length === 0) return [];
  gatewayProvider ??= createGateway({ apiKey: requireEnv("AI_GATEWAY_API_KEY") });
  const { embeddings } = await embedMany({
    model: gatewayProvider.textEmbeddingModel(EMBEDDING_MODEL),
    values: texts,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
    maxRetries: 0,
  });
  if (embeddings.length !== texts.length || embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error(`Expected ${texts.length} embeddings of ${EMBEDDING_DIMENSIONS} dimensions`);
  }
  return embeddings;
};

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

// Milliseconds to wait when the provider refused for rate, null for any other error.
export function aiRateLimitWaitMs(error: unknown): number | null {
  const e = error as { statusCode?: number; responseHeaders?: Record<string, string> } | null;
  if (e?.statusCode !== 429 && e?.statusCode !== 529) return null;
  const seconds = Number(e.responseHeaders?.["retry-after"]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}
