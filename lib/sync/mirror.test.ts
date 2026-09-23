import { describe, expect, it } from "vitest";

import { initialBucket, isInbound, mirrorState, nextSeenAt } from "./mirror";

describe("mirrorState", () => {
  it("inbox thread still in Gmail's inbox is not archived", () => {
    expect(mirrorState([["INBOX", "UNREAD"], ["INBOX"]], "inbox")).toEqual({
      archived: false,
      trashed: false,
      spam: false,
      unread: true,
    });
  });

  it("archived on the phone: INBOX gone from every message", () => {
    expect(mirrorState([["CATEGORY_PERSONAL"], ["IMPORTANT"]], "inbox").archived).toBe(true);
  });

  it("one message still in the inbox keeps the thread there", () => {
    expect(mirrorState([["IMPORTANT"], ["INBOX"]], "inbox").archived).toBe(false);
  });

  it.each(["news", "paper_trail", "triage", "out"] as const)(
    "%s: missing INBOX is our own writeback, archive state untouched",
    (bucket) => {
      expect(mirrorState([["superfer/news"]], bucket)).not.toHaveProperty("archived");
    },
  );

  it("trash and spam need every message; archive is left alone while trashed", () => {
    expect(mirrorState([["TRASH"], ["TRASH"]], "inbox")).toEqual({ trashed: true, spam: false, unread: false });
    expect(mirrorState([["TRASH"], ["INBOX"]], "inbox").trashed).toBe(false);
    expect(mirrorState([["SPAM", "UNREAD"]], "inbox")).toMatchObject({ spam: true, unread: true });
  });

  it("ignores drafts", () => {
    expect(mirrorState([["INBOX"], ["DRAFT"]], "inbox").archived).toBe(false);
    expect(mirrorState([["TRASH"], ["DRAFT", "UNREAD"]], "inbox")).toMatchObject({ trashed: true, unread: false });
  });
});

describe("nextSeenAt", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const earlier = new Date("2026-09-22T12:00:00Z");

  it("unread in Gmail clears it", () => expect(nextSeenAt(true, earlier, now)).toBeNull());
  it("read in Gmail keeps the first seen time", () => expect(nextSeenAt(false, earlier, now)).toBe(earlier));
  it("read in Gmail stamps now when we had none", () => expect(nextSeenAt(false, null, now)).toBe(now));
});

describe("isInbound", () => {
  it("SENT label means outbound, even from an alias", () => {
    expect(isInbound(["SENT"], "alias@x.com", "me@x.com")).toBe(false);
  });
  it("from the account address is outbound", () => {
    expect(isInbound(["INBOX"], "Me@X.com", "me@x.com")).toBe(false);
  });
  it("anyone else is inbound", () => {
    expect(isInbound(["INBOX"], "ana@y.com", "me@x.com")).toBe(true);
  });
});

describe("initialBucket", () => {
  it.each([
    [["INBOX", "CATEGORY_PERSONAL"], "inbox"],
    [["INBOX", "CATEGORY_PROMOTIONS"], "news"],
    [["CATEGORY_FORUMS"], "news"],
    [["CATEGORY_UPDATES"], "paper_trail"],
    [[], "inbox"],
  ] as const)("%j -> %s", (labels, bucket) => {
    expect(initialBucket([...labels])).toBe(bucket);
  });
});
