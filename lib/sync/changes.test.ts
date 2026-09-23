import { describe, expect, it, vi } from "vitest";

import { FALLBACK_OVERLAP_MS, INITIAL_WINDOW_DAYS, collectChanges, fallbackQuery, historyThreadIds } from "./changes";
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

describe("fallbackQuery", () => {
  it("re-reads an hour before the last good sync", () => {
    const last = new Date("2026-09-23T10:00:00Z");
    expect(fallbackQuery(last, now)).toBe(`after:${(last.getTime() - FALLBACK_OVERLAP_MS) / 1000}`);
  });

  it("looks back the initial window without a last sync", () => {
    expect(fallbackQuery(null, now)).toBe(`after:${(now.getTime() - INITIAL_WINDOW_DAYS * 86_400_000) / 1000}`);
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
    expect(changes).toEqual({ mode: "history", gmailThreadIds: ["t1", "t2"], cursor: "160" });
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
    });
  });

  it("falls back to listing since the last sync when the cursor is stale", async () => {
    const lastSyncAt = new Date("2026-09-20T08:00:00Z");
    const gmail = mockGmail({ history: [null], threadPages: [["t1", "t2"], ["t2", "t3"]], profileHistoryId: "999" });
    const changes = await collectChanges(gmail, { historyId: "5", lastSyncAt }, now);
    expect(changes).toEqual({ mode: "fallback", gmailThreadIds: ["t1", "t2", "t3"], cursor: "999" });
    expect(gmail.listThreadIds).toHaveBeenCalledWith(fallbackQuery(lastSyncAt, now), undefined);
    expect(gmail.listThreadIds).toHaveBeenCalledWith(fallbackQuery(lastSyncAt, now), "next");
  });

  it("takes the new cursor before listing, so mail arriving mid-list is read next pass", async () => {
    const gmail = mockGmail({ history: [null], threadPages: [["t1"]] });
    await collectChanges(gmail, { historyId: "5", lastSyncAt: now }, now);
    expect(gmail.getProfile.mock.invocationCallOrder[0]).toBeLessThan(
      gmail.listThreadIds.mock.invocationCallOrder[0],
    );
  });

  it("drops history pages read before the cursor turned out stale", async () => {
    const gmail = mockGmail({
      history: [{ history: [{ messagesAdded: [{ message: { threadId: "old" } }] }], historyId: "7", nextPageToken: "p2" }, null],
      threadPages: [["t9"]],
    });
    const changes = await collectChanges(gmail, { historyId: "5", lastSyncAt: now }, now);
    expect(changes.mode).toBe("fallback");
    expect(changes.gmailThreadIds).toEqual(["t9"]);
  });

  it("first sync of an account lists the initial window", async () => {
    const gmail = mockGmail({ threadPages: [["t1"]], profileHistoryId: "42" });
    const changes = await collectChanges(gmail, { historyId: null, lastSyncAt: null }, now);
    expect(changes).toEqual({ mode: "initial", gmailThreadIds: ["t1"], cursor: "42" });
    expect(gmail.listHistory).not.toHaveBeenCalled();
    expect(gmail.listThreadIds).toHaveBeenCalledWith(fallbackQuery(null, now), undefined);
  });
});
