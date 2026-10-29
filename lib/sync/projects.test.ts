import { describe, expect, it } from "vitest";

import { projectFromLabels, projectSlug } from "./projects";
import { mirrorChange, type LabelIds } from "./writeback";

const rows = [
  { projectId: "gobcan", gmailLabelId: "Label_10" },
  { projectId: "ulpgc", gmailLabelId: "Label_20" },
];

describe("projectFromLabels", () => {
  it("moves a thread into the project whose label it carries", () => {
    expect(projectFromLabels(["INBOX", "Label_10"], rows, null)).toBe("gobcan");
    expect(projectFromLabels(["Label_20"], rows, "gobcan")).toBe("ulpgc");
  });

  it("keeps a thread that still carries its own project's label", () => {
    expect(projectFromLabels(["Label_10", "Label_20"], rows, "gobcan")).toBeUndefined();
  });

  it("takes a thread out once its project's known label is gone", () => {
    expect(projectFromLabels(["INBOX"], rows, "gobcan")).toBeNull();
  });

  it("leaves a thread alone where its project's label is not known on the account", () => {
    expect(projectFromLabels(["INBOX"], [rows[1]], "gobcan")).toBeUndefined();
    expect(projectFromLabels(["INBOX"], rows, null)).toBeUndefined();
  });
});

describe("mirrorChange with a project", () => {
  const ids: LabelIds = { inbox: "B_in", news: "B_news", paper_trail: "B_pt", receipts: "B_rc", triage: "B_tr" };
  const state = { bucket: "inbox" as const, archived: false, seen: true, trashed: false, spam: false, starred: false };

  it("carries the project's label in place of the bucket's, out of the inbox", () => {
    const change = mirrorChange(state, ids, { own: "Label_10", all: ["Label_10", "Label_20"] });
    expect(change.addLabelIds).toContain("Label_10");
    expect(change.addLabelIds).not.toContain("INBOX");
    expect(change.removeLabelIds).toEqual(expect.arrayContaining(["INBOX", "B_in", "B_news", "Label_20"]));
    expect(change.removeLabelIds).not.toContain("Label_10");
  });

  it("drops every project label from a thread outside them", () => {
    const change = mirrorChange(state, ids, { own: null, all: ["Label_10", "Label_20"] });
    expect(change.addLabelIds).toEqual(expect.arrayContaining(["B_in", "INBOX"]));
    expect(change.removeLabelIds).toEqual(expect.arrayContaining(["Label_10", "Label_20"]));
  });
});

describe("projectSlug", () => {
  it("makes a readable address", () => {
    expect(projectSlug("AI GobCan")).toBe("ai-gobcan");
    expect(projectSlug("Educación ULPGC")).toBe("educacion-ulpgc");
    expect(projectSlug("!!!")).toBe("project");
  });
});
