import { createAnthropic } from "@ai-sdk/anthropic";

// Shared state handed to Jev. Plain JSON only.
export type JevState = { [key: string]: unknown };

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> }
  | { type: "score"; instructions: string; criteria: readonly string[] }
  | { type: "noul"; instructions: string };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | {
      type: "score";
      // 0-indexed position over the criteria levels, fractional.
      score: number;
      confidence?: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
    }
  // Probability of yes, 0-1.
  | { type: "noul"; noul: number };

export type JevResponse = {
  answers: Record<string, JevAnswer>;
  response: { modelId: string };
};

export const JEV_URL = "https://www.jevai.org/api/v1/decisions";
export const JEV_MODEL = "typesafe-ai/jev";
export const JEV_MAX_BODY_BYTES = 32 * 1024;
export const JEV_TIMEOUT_MS = 30_000;
export const CLAUDE_MODEL = "claude-sonnet-5";

export class JevError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "JevError";
  }
}

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

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

type StringSlot = { value: string; set: (v: string) => void };

function longestString(node: unknown): StringSlot | null {
  let best: StringSlot | null = null;
  const visit = (value: unknown, set: (v: string) => void) => {
    if (typeof value === "string") {
      if (!best || value.length > best.value.length) best = { value, set };
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, (s) => (value[i] = s)));
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) visit(obj[key], (s) => (obj[key] = s));
    }
  };
  visit(node, () => {});
  return best;
}

// Serialize the request under the body cap, cutting the longest strings in state first.
export function jevBody(state: JevState, questions: Record<string, JevQuestion>): string {
  const trimmed = structuredClone(state);
  for (;;) {
    const body = JSON.stringify({ model: JEV_MODEL, state: trimmed, questions });
    const excess = byteLength(body) - JEV_MAX_BODY_BYTES;
    if (excess <= 0) return body;
    const slot = longestString(trimmed);
    if (!slot || slot.value.length === 0) {
      throw new JevError(`Jev request is ${excess} bytes over the ${JEV_MAX_BODY_BYTES} byte cap`);
    }
    // Removing n chars removes at least n bytes; the margin covers the ellipsis and escapes.
    slot.set(slot.value.slice(0, Math.max(0, slot.value.length - excess - 16)) + "…");
  }
}

type Envelope = { code?: number; message?: string; data?: { answers?: Record<string, JevAnswer>; model?: string } };

// One Jev call: typed questions against one shared state, calibrated answers back.
export async function evaluateWithJev(
  state: JevState,
  questions: Record<string, JevQuestion>,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<JevResponse> {
  const doFetch = options.fetch ?? fetch;
  const body = jevBody(state, questions);

  let res: Response;
  try {
    res = await doFetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("JEV_API_KEY")}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? JEV_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : String(err);
    throw new JevError(`Jev request failed: ${reason}`);
  }

  const text = await res.text();
  let envelope: Envelope | null = null;
  try {
    envelope = JSON.parse(text) as Envelope;
  } catch {
    // Not JSON; reported below with the raw text.
  }

  if (!envelope || typeof envelope.code !== "number") {
    throw new JevError(`Jev returned HTTP ${res.status}: ${text.slice(0, 200)}`, null, res.status);
  }
  if (envelope.code !== 0 || !res.ok) {
    throw new JevError(
      `Jev error ${envelope.code}: ${envelope.message ?? "unknown"}`,
      envelope.code,
      res.status,
    );
  }
  const answers = envelope.data?.answers;
  if (!answers) throw new JevError("Jev response has no answers", envelope.code, res.status);
  return { answers, response: { modelId: envelope.data?.model ?? JEV_MODEL } };
}
