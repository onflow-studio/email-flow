import { describe, expect, it } from "vitest";

import { allowedTarget } from "./screener";

describe("allowedTarget", () => {
  it("uses the default bucket the user picked", () => {
    expect(allowedTarget("news", { bucket: "inbox", urgency: 1 })).toBe("news");
  });

  it("falls back to the model's last choice", () => {
    expect(allowedTarget(null, { bucket: "paper_trail", urgency: 2 })).toBe("paper_trail");
  });

  it("applies the promotion rule to released paper trail", () => {
    expect(allowedTarget(null, { bucket: "paper_trail", urgency: 4 })).toBe("inbox");
  });

  it("defaults to inbox when never classified", () => {
    expect(allowedTarget(null, undefined)).toBe("inbox");
  });
});
