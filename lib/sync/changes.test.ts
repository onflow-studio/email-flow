import { describe, expect, it, vi } from "vitest";

import { FALLBACK_OVERLAP_MS, INITIAL_WINDOW_DAYS, collectChanges, historyThreadIds, newCatchUp } from "./changes";
import type { GmailSyncPort, HistoryPage } from "./gmail";

function mockGmail(opts: {
  history?: (HistoryPage | null)[];
  threadPages?: string[][];
  profileHistoryId?: string;
}) {
  const history = [...(opts.history ?? [])];
  const pages = [...(opts.threadPages ?? [[]])];
  return {
    getProfile: vi.fn(async () => ({ emailAddress: "me@x.com", historyId: opts.profileHistoryId ?? "900" })),
    listHistory: vi.fn(async () => history.shift() ?? null),
    listThreadIds: vi.fn(async () => {
      const threadIds = pages.shift() ?? [];
      return { threadIds, nextPageToken: pages.length ? "next" : null };
    }),
    getThreadLabels: vi.fn(async () => null),
    getMessage: vi.fn(async () => null),
  } satisfies GmailSyncPort;
}

const now = new Date("2026-09-23T12:00:00Z");

describe("historyThreadIds", () => {
  it("collects threads from added, deleted and relabelled messages, once each", () => {
    expect(
      historyThreadIds([
        { id: "1", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
        { id: "2", labelsRemoved: [{ message: { id: "m2", threadId: "t2" }, labelIds: ["INBOX"] }] },
        { id: "3", labelsAdded: [{ message: { id: "m1", threadId: "t1" }, labelIds: ["UNREAD"] }] },
        { id: "4", messagesDeleted: [{ message: { id: "m3", threadId: "t3" } }] },
        { id: "5", messages: [{ id: "m9", threadId: "t9" }] },
      ]),
    ).toEqual(["t1", "t2", "t3"]);
  });
});

describe("newCatchUp", () => {
  it("re-reads an hour before the last good sync, up to now", () => {
    const last = new Date("2026-09-23T10:00:00Z");
    expect(newCatchUp("fallback", last, now)).toEqual({
      mode: "fallback",
      after: (last.getTime() - FALLBACK_OVERLAP_MS) / 1000,
      before: now.getTime() / 1000,
      pageToken: null,
      offset: 0,
      seen: 0,
    });
  });

  it("looks back the initial window without a last sync", () => {
    expect(newCatchUp("initial", null, now).after).toBe((now.getTime() - INITIAL_WINDOW_DAYS * 86_400_000) / 1000);
  });
});

describe("collectChanges", () => {
  it("follows history pages from the cursor and returns the newest history id", async () => {
    const gmail = mockGmail({
      history: [
        { history: [{ messagesAdded: [{ message: { threadId: "t1" } }] }], historyId: "150", nextPageToken: "p2" },
        { history: [{ labelsRemoved: [{ message: { threadId: "t2" } }] }], historyId: "160", nextPageToken: null },
      ],
    });
    const changes = await collectChanges(gmail, { historyId: "100", lastSyncAt: now }, now);
    expect(changes).toEqual({ mode: "history", gmailThreadIds: ["t1", "t2"], cursor: "160", catchUp: null });
    expect(gmail.listHistory).toHaveBeenNthCalledWith(1, "100", undefined);
    expect(gmail.listHistory).toHaveBeenNthCalledWith(2, "100", "p2");
    expect(gmail.listThreadIds).not.toHaveBeenCalled();
  });

  it("keeps the cursor moving when nothing changed", async () => {
    const gmail = mockGmail({ history: [{ history: [], historyId: "120", nextPageToken: null }] });
    expect(await collectChanges(gmail, { historyId: "100", lastSyncAt: now }, now)).toEqual({
      mode: "history",
      gmailThreadIds: [],
      cursor: "120",
      catchUp: null,
    });
  });

  it("on a stale cursor, takes a new one and leaves the listing since the last sync to catch-up", async () => {
    const lastSyncAt = new Date("2026-09-20T08:00:00Z");
    const gmail = mockGmail({ history: [null], profileHistoryId: "999" });
    const changes = await collectChanges(gmail, { historyId: "5", lastSyncAt }, now);
    expect(changes).toEqual({
      mode: "fallback",
      gmailThreadIds: [],
      cursor: "999",
      catchUp: newCatchUp("fallback", lastSyncAt, now),
    });
    // Nothing listed yet: that runs in saved batches, so a quota error mid-way keeps what was done.
    expect(gmail.listThreadIds).not.toHaveBeenCalled();
  });

  it("drops history pages read before the cursor turned out stale", async () => {
    const gmail = mockGmail({
      history: [{ history: [{ messagesAdded: [{ message: { threadId: "old" } }] }], historyId: "7", nextPageToken: "p2" }, null],
    });
    const changes = await collectChanges(gmail, { historyId: "5", lastSyncAt: now }, now);
    expect(changes.mode).toBe("fallback");
    expect(changes.gmailThreadIds).toEqual([]);
  });

  it("first sync of an account takes a cursor and a catch-up over the initial window", async () => {
    const gmail = mockGmail({ profileHistoryId: "42" });
    const changes = await collectChanges(gmail, { historyId: null, lastSyncAt: null }, now);
    expect(changes).toEqual({ mode: "initial", gmailThreadIds: [], cursor: "42", catchUp: newCatchUp("initial", null, now) });
    expect(gmail.listHistory).not.toHaveBeenCalled();
  });
});
