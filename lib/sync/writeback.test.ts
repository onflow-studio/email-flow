import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUCKET_LABELS,
  INBOX_LABEL,
  clearLabelCache,
  ensureLabels,
  labelChange,
  writeBucket,
  type GmailLabelsPort,
  type LabelIds,
} from "./writeback";

const ids: LabelIds = { inbox: "L_in", news: "L_news", paper_trail: "L_pt", triage: "L_tri" };

function mockGmail(existing: { id: string; name: string }[] = []) {
  let next = 0;
  return {
    listLabels: vi.fn(async () => existing),
    createLabel: vi.fn(async (name: string) => ({ id: `new${++next}`, name })),
    modifyThread: vi.fn(async () => {}),
  } satisfies GmailLabelsPort;
}

beforeEach(() => clearLabelCache());

describe("labelChange", () => {
  it("inbox: sets its label, removes the others, keeps INBOX", () => {
    expect(labelChange("inbox", false, ids)).toEqual({
      addLabelIds: ["L_in", INBOX_LABEL],
      removeLabelIds: ["L_news", "L_pt", "L_tri"],
    });
  });

  it("inbox but archived: does not put it back in Gmail's inbox", () => {
    expect(labelChange("inbox", true, ids).addLabelIds).toEqual(["L_in"]);
  });

  it.each(["news", "paper_trail", "triage"] as const)("%s: removes INBOX", (bucket) => {
    const change = labelChange(bucket, false, ids);
    expect(change.addLabelIds).toEqual([ids[bucket]]);
    expect(change.removeLabelIds).toContain(INBOX_LABEL);
    expect(change.removeLabelIds).not.toContain(ids[bucket]);
    expect(change.removeLabelIds).toHaveLength(4);
  });

  it("out: no bucket label and out of the inbox", () => {
    expect(labelChange("out", false, ids)).toEqual({
      addLabelIds: [],
      removeLabelIds: ["L_in", "L_news", "L_pt", "L_tri", INBOX_LABEL],
    });
  });
});

describe("ensureLabels", () => {
  it("creates only the missing superfer labels and caches per account", async () => {
    const gmail = mockGmail([
      { id: "L_in", name: BUCKET_LABELS.inbox },
      { id: "Other", name: "Receipts" },
    ]);
    const first = await ensureLabels("acc1", gmail);
    expect(first.inbox).toBe("L_in");
    expect(gmail.createLabel.mock.calls.map((c) => c[0])).toEqual([
      "superfer/news",
      "superfer/paper-trail",
      "superfer/triage",
    ]);
    await ensureLabels("acc1", gmail);
    expect(gmail.listLabels).toHaveBeenCalledTimes(1);
  });
});

describe("writeBucket", () => {
  it("modifies the Gmail thread with the bucket's label change", async () => {
    const gmail = mockGmail(Object.entries(BUCKET_LABELS).map(([b, name]) => ({ id: ids[b as keyof LabelIds], name })));
    await writeBucket({ accountId: "acc1", gmailThreadId: "g1", bucket: "news", archived: false }, gmail);
    expect(gmail.modifyThread).toHaveBeenCalledWith("g1", labelChange("news", false, ids));
  });

  it("rethrows so the job retries, and drops the label cache", async () => {
    const gmail = mockGmail();
    gmail.modifyThread.mockRejectedValueOnce(new Error("label not found"));
    await expect(
      writeBucket({ accountId: "acc1", gmailThreadId: "g1", bucket: "news", archived: false }, gmail),
    ).rejects.toThrow("label not found");
    await ensureLabels("acc1", gmail);
    expect(gmail.listLabels).toHaveBeenCalledTimes(2);
  });
});
