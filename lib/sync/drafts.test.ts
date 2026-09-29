import { describe, expect, it } from "vitest";

import { planDrafts } from "./drafts";

const start = new Date("2026-09-29T10:00:00Z");
const before = new Date("2026-09-29T09:00:00Z");
const after = new Date("2026-09-29T10:00:01Z");

describe("planDrafts", () => {
  it("fetches new and changed drafts, skips unchanged ones", () => {
    const plan = planDrafts(
      [
        { gmailDraftId: "d1", gmailMessageId: "m1" },
        { gmailDraftId: "d2", gmailMessageId: "m2b" },
        { gmailDraftId: "d3", gmailMessageId: "m3" },
      ],
      [
        { id: "a", gmailDraftId: "d1", gmailMessageId: "m1", updatedAt: before },
        { id: "b", gmailDraftId: "d2", gmailMessageId: "m2", updatedAt: before },
      ],
      start,
    );
    expect(plan.fetch).toEqual(["d2", "d3"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes drafts gone from Gmail, but not ones saved during the pass", () => {
    const plan = planDrafts(
      [],
      [
        { id: "old", gmailDraftId: "d1", gmailMessageId: "m1", updatedAt: before },
        { id: "fresh", gmailDraftId: "d2", gmailMessageId: "m2", updatedAt: after },
      ],
      start,
    );
    expect(plan.remove).toEqual(["old"]);
  });
});
