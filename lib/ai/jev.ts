// TypeSafe's Jev: typed decisions with calibrated probabilities, no text generation.
// Pinned to a version: thresholds tuned against it must not move when the alias does.
export const JEV_MODEL = "jev-1.13.0";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;

export type JevChoice = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type JevResponse = {
  model: string;
  answers: Record<string, JevChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

// Optional provider: callers skip Jev when the key is missing (tests, preview deployments).
export function jevConfigured() {
  return Boolean(process.env.JEV_API_KEY);
}

// One call, every question evaluated against the same state. Throws on any error, no retries.
export async function askJev(state: unknown, questions: Record<string, JevChoice>): Promise<JevResponse> {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error("JEV_API_KEY is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jev returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as JevResponse;
}
