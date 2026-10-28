/** The [n] numbers cited in the text, in order of first use, with any above count dropped. */
export function parseCitations(text: string, count: number): number[] {
  const out: number[] = [];
  for (const [, digits] of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(digits);
    if (n >= 1 && n <= count && !out.includes(n)) out.push(n);
  }
  return out;
}
