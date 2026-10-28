import type { AskEvent } from "@/lib/ai/ask";

const QUESTION_WORDS = new Set([
  "what", "when", "where", "who", "which", "why", "how", "find", "show", "list", "did", "do", "does",
  "is", "are", "was", "were", "can", "que", "cuando", "donde", "quien", "cual", "como", "busca",
  "buscar", "muestra", "muestrame", "encuentra", "hay",
]);

export function looksLikeQuestion(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.every((word) => /^[^\s:]+:\S*$/.test(word))) return false;
  if (text.trimEnd().endsWith("?")) return true;
  const first = words[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return words.length >= 3 && QUESTION_WORDS.has(first);
}

/** The ask route sends one JSON event per line, including when a chunk splits a line. */
export async function* readAsk(response: Response): AsyncGenerator<AskEvent> {
  if (!response.body) throw new Error("missing ask stream");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as AskEvent;
    }
    if (pending.trim()) yield JSON.parse(pending) as AskEvent;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
