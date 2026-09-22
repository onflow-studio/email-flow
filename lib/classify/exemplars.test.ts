import { describe, expect, it } from "vitest";

import { MAX_EXEMPLARS, selectExemplars, subjectWords } from "./exemplars";
import type { Exemplar } from "./types";

const target = { senderEmail: "billing@vercel.com", domain: "vercel.com", subject: "Payment failed for Pro plan" };

let n = 0;
function ex(overrides: Partial<Exemplar>): Exemplar {
  n += 1;
  return {
    id: `c${n}`,
    senderEmail: "someone@else.com",
    domain: "else.com",
    subject: "Unrelated",
    fromBucket: "paper_trail",
    toBucket: "inbox",
    createdAt: new Date(2026, 0, n),
    ...overrides,
  };
}

describe("selectExemplars", () => {
  it("ranks same sender, then same domain, then shared subject words", () => {
    const words = ex({ subject: "Your payment failed" });
    const domain = ex({ senderEmail: "team@vercel.com", domain: "vercel.com" });
    const same = ex({ senderEmail: "billing@vercel.com", domain: "vercel.com" });
    const picked = selectExemplars([words, domain, same], target);
    expect(picked.map((e) => e.id)).toEqual([same.id, domain.id, words.id]);
  });

  it("drops unrelated corrections", () => {
    expect(selectExemplars([ex({})], target)).toEqual([]);
  });

  it("caps at five and prefers the newest on ties", () => {
    const many = Array.from({ length: 8 }, () => ex({ senderEmail: target.senderEmail, domain: "vercel.com" }));
    const picked = selectExemplars(many, target);
    expect(picked).toHaveLength(MAX_EXEMPLARS);
    expect(picked[0].id).toBe(many[7].id);
  });

  it("dedupes candidates that come from both queries", () => {
    const same = ex({ senderEmail: target.senderEmail });
    expect(selectExemplars([same, same], target)).toHaveLength(1);
  });
});

describe("subjectWords", () => {
  it("ignores reply prefixes and short words", () => {
    expect([...subjectWords("Re: Fwd: Your plan is due")]).toEqual(["your", "plan"]);
  });

  it("keeps accented words", () => {
    expect(subjectWords("Factura de septiembre, envío").has("envío")).toBe(true);
  });
});
