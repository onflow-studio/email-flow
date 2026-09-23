import { describe, expect, it } from "vitest";

import type { ThreadState } from "@/lib/actions/types";

import { compareCopies, mergeTimeline, mergedGroupId, reconcilePatch, replyCopy, sourceCopy, type Copy } from "./twins";

const now = new Date("2026-09-23T10:00:00Z");

const state = (over: Partial<ThreadState> = {}): ThreadState => ({
  bucket: "inbox",
  bucketSource: "ai",
  bucketConfidence: 0.9,
  bucketSuggested: false,
  seenAt: new Date("2026-09-23T02:00:00Z"),
  snoozedUntil: null,
  needsReply: false,
  deadlineAt: null,
  workAt: null,
  archived: false,
  trashed: false,
  spam: false,
  ...over,
});

const copy = (id: string, over: Partial<Copy> = {}): Copy => ({
  id,
  lastMessageAt: new Date("2026-09-22T09:00:00Z"),
  ...state(),
  ...over,
});

const first = (...copies: Copy[]) => [...copies].sort((a, b) => compareCopies(a, b, now))[0].id;

describe("mergedGroupId", () => {
  it("keeps the smallest key whatever the order, so linking is idempotent", () => {
    expect(mergedGroupId(["b", "a", "c"])).toBe("a");
    expect(mergedGroupId(new Set(["c", "a"]))).toBe(mergedGroupId(["a", "c"]));
  });
});

describe("compareCopies", () => {
  it("shows the live copy over an archived or trashed one", () => {
    expect(first(copy("a", { archived: true }), copy("b"))).toBe("b");
    expect(first(copy("a"), copy("b", { trashed: true }))).toBe("a");
  });

  it("shows the unsnoozed copy over one snoozed ahead, but a due snooze counts as back", () => {
    expect(first(copy("a", { snoozedUntil: new Date("2026-09-28T07:00:00Z") }), copy("b"))).toBe("b");
    expect(first(copy("a", { snoozedUntil: new Date("2026-09-20T07:00:00Z"), lastMessageAt: new Date("2026-09-23T00:00:00Z") }), copy("b"))).toBe("a");
  });

  it("then in Work, then unseen, then newest", () => {
    expect(first(copy("a"), copy("b", { workAt: now }))).toBe("b");
    expect(first(copy("a"), copy("b", { seenAt: null }))).toBe("b");
    expect(first(copy("a"), copy("b", { lastMessageAt: now }))).toBe("b");
    expect(first(copy("b"), copy("a"))).toBe("a");
  });
});

describe("sourceCopy", () => {
  it("takes the copy with the latest user action, newest first", () => {
    expect(sourceCopy([{ threadId: "b" }, { threadId: "a" }], ["a", "b"])).toBe("b");
  });

  it("is none without an action on a copy", () => {
    expect(sourceCopy([], ["a", "b"])).toBeNull();
    expect(sourceCopy([{ threadId: null }], ["a", "b"])).toBeNull();
  });
});

describe("reconcilePatch", () => {
  it("copies the snooze the user set onto the twin", () => {
    const until = new Date("2026-09-28T07:00:00Z");
    const patch = reconcilePatch(state({ snoozedUntil: until, needsReply: true }), state());
    expect(patch).toEqual({ snoozedUntil: until, needsReply: true });
  });

  it("is null when the copies agree, dates compared by time", () => {
    const a = state({ workAt: new Date("2026-09-23T00:00:00Z") });
    const b = state({ workAt: new Date("2026-09-23T00:00:00Z") });
    expect(reconcilePatch(a, b)).toBeNull();
  });

  it("carries archive, trash and bucket", () => {
    expect(reconcilePatch(state({ archived: true, bucket: "news", bucketSource: "user" }), state())).toEqual({
      archived: true,
      bucket: "news",
      bucketSource: "user",
    });
  });

  it("moves the twin into Work and out again, with the thread's own needs reply and deadline", () => {
    const at = new Date("2026-09-23T08:00:00Z");
    const due = new Date("2026-09-30T16:00:00Z");
    expect(reconcilePatch(state({ workAt: at, needsReply: true, deadlineAt: due }), state())).toEqual({
      workAt: at,
      needsReply: true,
      deadlineAt: due,
    });
    expect(reconcilePatch(state({ archived: true }), state({ workAt: at }))).toEqual({ archived: true, workAt: null });
  });
});

describe("mergeTimeline", () => {
  it("keeps one message per Message-ID, the first copy's, oldest first", () => {
    const personal = [
      { id: "p1", date: "2026-09-22T09:00:00Z", messageId: "<x@a>", from: "personal" },
      { id: "p2", date: "2026-09-22T11:00:00Z", messageId: "<z@a>", from: "personal" },
    ];
    const work2 = [
      { id: "r1", date: "2026-09-22T09:00:00Z", messageId: "<x@a>", from: "work2" },
      { id: "r2", date: "2026-09-22T10:00:00Z", messageId: "<y@a>", from: "work2" },
    ];
    expect(mergeTimeline([personal, work2]).map((m) => m.id)).toEqual(["p1", "r2", "p2"]);
  });

  it("never merges messages without a Message-ID", () => {
    const a = [{ id: "a", date: "2026-09-22T09:00:00Z", messageId: null }];
    const b = [{ id: "b", date: "2026-09-22T09:00:00Z" }];
    expect(mergeTimeline([a, b])).toHaveLength(2);
  });
});

describe("replyCopy", () => {
  const copies = [
    { id: "p", accountEmail: "me@personal.example" },
    { id: "r", accountEmail: "me@work2.example" },
  ];

  it("answers from the account the latest inbound message was addressed to", () => {
    expect(replyCopy(copies, { to: [{ email: "Me@Work2.example" }], cc: [] }, "p")).toBe("r");
    expect(replyCopy(copies, { to: [{ email: "x@y.com" }], cc: [{ email: "me@personal.example" }] }, "r")).toBe("p");
  });

  it("keeps the opened copy when it was addressed too, or nobody matches", () => {
    const both = { to: [{ email: "me@personal.example" }, { email: "me@work2.example" }], cc: [] };
    expect(replyCopy(copies, both, "r")).toBe("r");
    expect(replyCopy(copies, { to: [{ email: "list@x.com" }], cc: [] }, "p")).toBe("p");
    expect(replyCopy(copies, undefined, "p")).toBe("p");
  });
});
