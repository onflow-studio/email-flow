import { describe, expect, it } from "vitest";

import { isInvalidGrant } from "@/lib/gmail/errors";

import { accessExpiry, expiryText, tokenLifetimeDays } from "./expiry";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const issued = new Date("2026-01-01T00:00:00Z");
const at = (ms: number) => new Date(issued.getTime() + ms);

describe("tokenLifetimeDays", () => {
  it("defaults to 7 when unset, blank or invalid", () => {
    expect(tokenLifetimeDays(undefined)).toBe(7);
    expect(tokenLifetimeDays("")).toBe(7);
    expect(tokenLifetimeDays("soon")).toBe(7);
    expect(tokenLifetimeDays("-2")).toBe(7);
  });

  it("reads a number, 0 included", () => {
    expect(tokenLifetimeDays("0")).toBe(0);
    expect(tokenLifetimeDays("30")).toBe(30);
  });
});

describe("accessExpiry", () => {
  const account = { refreshTokenIssuedAt: issued, lastSyncAt: null };

  it("says nothing with more than a day left", () => {
    expect(accessExpiry(account, 7, at(5 * DAY))).toBeNull();
    expect(accessExpiry(account, 7, at(6 * DAY - 1))).toBeNull();
  });

  it("warns within the last day", () => {
    expect(accessExpiry(account, 7, at(6 * DAY + HOUR))).toEqual({ state: "expiring", expiresAt: at(7 * DAY) });
  });

  it("reports expired once past the lifetime", () => {
    expect(accessExpiry(account, 7, at(7 * DAY))?.state).toBe("expired");
    expect(accessExpiry(account, 7, at(9 * DAY))?.state).toBe("expired");
  });

  it("drops the expired claim when a sync worked after the estimate", () => {
    const synced = { refreshTokenIssuedAt: issued, lastSyncAt: at(8 * DAY) };
    expect(accessExpiry(synced, 7, at(8 * DAY + HOUR))).toBeNull();
  });

  it("says nothing when the issue time is unknown or warnings are off", () => {
    expect(accessExpiry({ refreshTokenIssuedAt: null, lastSyncAt: null }, 7, at(30 * DAY))).toBeNull();
    expect(accessExpiry(account, 0, at(30 * DAY))).toBeNull();
  });
});

describe("expiryText", () => {
  it("counts hours, then minutes", () => {
    const expiresAt = at(7 * DAY);
    expect(expiryText({ state: "expiring", expiresAt }, at(6 * DAY + 2 * HOUR))).toBe("gmail access expires in 22h");
    expect(expiryText({ state: "expiring", expiresAt: expiresAt.toISOString() }, at(7 * DAY - 90_000))).toBe(
      "gmail access expires in 1m",
    );
    expect(expiryText({ state: "expired", expiresAt })).toBe("gmail access expired");
  });
});

describe("isInvalidGrant", () => {
  it("spots Google's refusal in a response body or message", () => {
    expect(isInvalidGrant({ response: { data: { error: "invalid_grant" } } })).toBe(true);
    expect(isInvalidGrant(new Error("invalid_grant"))).toBe(true);
    expect(isInvalidGrant(new Error("invalid_grant: Token has been expired or revoked."))).toBe(true);
  });

  it("ignores other failures", () => {
    expect(isInvalidGrant({ response: { data: { error: "invalid_client" } } })).toBe(false);
    expect(isInvalidGrant(new Error("socket hang up"))).toBe(false);
    expect(isInvalidGrant(null)).toBe(false);
  });
});
