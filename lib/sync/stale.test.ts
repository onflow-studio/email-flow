import { describe, expect, it } from "vitest";

import { digestSection, staleCutoffs, staleReason, type StaleThread } from "./stale";

const DAY = 86_400_000;
const now = new Date("2026-10-23T12:00:00Z");
const before = (days: number) => new Date(now.getTime() - days * DAY);
const cutoffs = staleCutoffs(now, { workDays: 7, replyDays: 3, triageDays: 3 });
const thread: StaleThread = {
  workAt: null, needsReply: false, deadlineAt: null, lastMessageAt: now,
  bucket: "inbox", createdAt: now, snoozedUntil: null,
};
const reason = (changes: Partial<StaleThread>) => staleReason({ ...thread, ...changes }, cutoffs, now);

describe("staleReason", () => {
  it("marks Work only after its threshold", () => {
    expect(reason({ workAt: before(7) })).toBeNull();
    expect(reason({ workAt: new Date(before(7).getTime() - 1) })).toEqual({ kind: "work", days: 7 });
    expect(reason({ workAt: before(9) })).toEqual({ kind: "work", days: 9 });
  });

  it("marks needs reply from the last message when there is no deadline", () => {
    expect(reason({ needsReply: true, lastMessageAt: before(3) })).toBeNull();
    expect(reason({ needsReply: true, lastMessageAt: before(4) })).toEqual({ kind: "reply", days: 4 });
    expect(reason({ needsReply: true, lastMessageAt: before(4), deadlineAt: before(1) })).toBeNull();
  });

  it("marks undecided Triage by creation time", () => {
    expect(reason({ bucket: "triage", createdAt: before(3) })).toBeNull();
    expect(reason({ bucket: "triage", createdAt: before(4) })).toEqual({ kind: "triage", days: 4 });
  });

  it("excludes an active snooze and accepts one that has ended", () => {
    const workAt = before(9);
    expect(reason({ workAt, snoozedUntil: new Date(now.getTime() + 1) })).toBeNull();
    expect(reason({ workAt, snoozedUntil: now })).toEqual({ kind: "work", days: 9 });
  });

  it("uses work, then reply, then triage when several match", () => {
    const all = { workAt: before(8), needsReply: true, lastMessageAt: before(5), bucket: "triage", createdAt: before(10) };
    expect(reason(all)?.kind).toBe("work");
    expect(reason({ ...all, workAt: null })?.kind).toBe("reply");
    expect(reason({ ...all, workAt: null, needsReply: false })?.kind).toBe("triage");
  });
});

describe("digestSection", () => {
  const section = (changes: Partial<StaleThread>) => digestSection({ ...thread, ...changes }, cutoffs, now);

  it("puts a deadline due within a day, or overdue, under deadlines before any stale reason", () => {
    expect(section({ deadlineAt: new Date(now.getTime() + DAY) })).toBe("deadline");
    expect(section({ deadlineAt: before(2), workAt: before(9) })).toBe("deadline");
    expect(section({ deadlineAt: new Date(now.getTime() + DAY + 1) })).toBeNull();
  });

  it("otherwise follows the stale reason", () => {
    expect(section({ workAt: before(9), deadlineAt: new Date(now.getTime() + 3 * DAY) })).toBe("work");
    expect(section({ needsReply: true, lastMessageAt: before(4) })).toBe("reply");
    expect(section({ bucket: "triage", createdAt: before(4) })).toBe("triage");
    expect(section({})).toBeNull();
  });

  it("leaves out an active snooze, deadline or not", () => {
    expect(section({ deadlineAt: before(1), snoozedUntil: new Date(now.getTime() + 1) })).toBeNull();
  });
});
