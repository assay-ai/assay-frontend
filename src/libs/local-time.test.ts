import { describe, expect, it } from "vitest";

import { formatClock, formatLocalDate, formatLocalDateTime, utcTitle } from "./local-time";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const UTC = { timeZone: "UTC", now: NOW };

describe("local time", () => {
  it("shows only the clock for today", () => {
    expect(formatLocalDateTime("2026-10-15T07:20:00Z", UTC)).toBe("07:20");
  });

  it("names yesterday and tomorrow", () => {
    expect(formatLocalDateTime("2026-10-14T23:05:00Z", UTC)).toBe("Yesterday 23:05");
    expect(formatLocalDateTime("2026-10-16T14:20:00Z", UTC)).toBe("Tomorrow 14:20");
  });

  it("adds the date further out, and the year only when it differs", () => {
    expect(formatLocalDateTime("2026-10-20T14:20:00Z", UTC)).toBe("Oct 20, 14:20");
    expect(formatLocalDate("2025-03-02T00:00:00Z", UTC)).toBe("Mar 2, 2025");
  });

  it("renders in the given zone, not UTC", () => {
    expect(formatClock("2026-10-15T07:20:00Z", { timeZone: "Asia/Tokyo" })).toBe("14:20");
  });

  it("gives the exact UTC instant for a tooltip", () => {
    expect(utcTitle("2026-10-15T07:20:33Z")).toBe("2026-10-15 07:20 UTC");
    expect(utcTitle(null)).toBeUndefined();
  });

  it("never throws on junk", () => {
    expect(formatLocalDateTime("not a date", UTC)).toBe("—");
    expect(formatLocalDateTime(undefined, UTC)).toBe("—");
  });
});
