import type { Exemplar } from "./types";

export const MAX_EXEMPLARS = 5;

const SAME_SENDER = 4;
const SAME_DOMAIN = 2;
const PER_SHARED_WORD = 1;

// Words of 4+ letters, lowercased. Short words are mostly noise ("re", "fwd", "your").
export function subjectWords(subject: string | null) {
  if (!subject) return new Set<string>();
  const words = subject
    .toLowerCase()
    .replace(/^((re|fwd?|aw|rv):\s*)+/i, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
  return new Set(words);
}

export function exemplarScore(
  exemplar: Exemplar,
  target: { senderEmail: string; domain: string; subject: string | null },
) {
  let score = 0;
  if (exemplar.senderEmail === target.senderEmail) score += SAME_SENDER;
  else if (exemplar.domain === target.domain) score += SAME_DOMAIN;
  const targetWords = subjectWords(target.subject);
  for (const word of subjectWords(exemplar.subject)) {
    if (targetWords.has(word)) score += PER_SHARED_WORD;
  }
  return score;
}

// Same sender first, then same domain, then shared subject words. Newest wins ties.
// Unrelated corrections are dropped: they would teach the model nothing about this thread.
export function selectExemplars(
  candidates: Exemplar[],
  target: { senderEmail: string; domain: string; subject: string | null },
  limit = MAX_EXEMPLARS,
) {
  const seen = new Set<string>();
  return candidates
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ c, score: exemplarScore(c, target) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.c.createdAt.getTime() - a.c.createdAt.getTime())
    .slice(0, limit)
    .map(({ c }) => c);
}
