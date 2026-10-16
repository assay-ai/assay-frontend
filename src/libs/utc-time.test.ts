import { describe, expect, it } from "vitest";

import { formatClock, formatDate, formatDateTime, formatRelative, utcDay, utcDayBounds, utcTitle } from "./utc-time";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const AT = { now: NOW };

describe("utc time", () => {
  it("shows only the clock for today, labelled", () => {
    expect(formatDateTime("2026-10-15T07:20:00Z", AT)).toBe("07:20 UTC");
  });

  it("names yesterday and tomorrow", () => {
    expect(formatDateTime("2026-10-14T23:05:00Z", AT)).toBe("Yesterday 23:05 UTC");
    expect(formatDateTime("2026-10-16T14:20:00Z", AT)).toBe("Tomorrow 14:20 UTC");
  });

  it("writes the day words in lowercase inside a sentence", () => {
    const mid = { ...AT, midSentence: true };
    expect(formatDateTime("2026-10-15T07:20:00Z", { ...mid, alwaysDay: true })).toBe("today 07:20 UTC");
    expect(formatDateTime("2026-10-14T23:05:00Z", mid)).toBe("yesterday 23:05 UTC");
    expect(formatDateTime("2026-10-16T14:20:00Z", mid)).toBe("tomorrow 14:20 UTC");
    expect(formatDateTime("2026-10-20T14:20:00Z", mid)).toBe("Oct 20, 14:20 UTC");
    expect(formatRelative("2026-10-15T08:05:00Z", mid)).toBe("today 08:05 UTC");
  });

  it("adds the date further out, and the year only when it differs", () => {
    expect(formatDateTime("2026-10-20T14:20:00Z", AT)).toBe("Oct 20, 14:20 UTC");
    expect(formatDate("2025-03-02T00:00:00Z", AT)).toBe("Mar 2, 2025");
  });

  it("is UTC whatever the machine's zone", () => {
    // 23:30 UTC is already the next day east of Greenwich; the UTC day decides.
    expect(formatClock("2026-10-15T23:30:00Z")).toBe("23:30");
    expect(formatDate("2026-10-15T23:30:00Z", AT)).toBe("Oct 15");
    expect(formatDateTime("2026-10-15T23:30:00Z", AT)).toBe("23:30 UTC");
    expect(formatDateTime("2026-10-16T00:30:00Z", AT)).toBe("Tomorrow 00:30 UTC");
    expect(formatDateTime("2026-09-15T08:40:05Z", { ...AT, seconds: true })).toBe("Sep 15, 08:40:05 UTC");
  });

  it("gives the exact UTC instant for a tooltip", () => {
    expect(utcTitle("2026-10-15T07:20:33Z")).toBe("2026-10-15 07:20 UTC");
    expect(utcTitle(null)).toBeUndefined();
  });

  it("never throws on junk", () => {
    expect(formatDateTime("not a date", AT)).toBe("—");
    expect(formatDateTime(undefined, AT)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  it("says minutes ago within the hour", () => {
    expect(formatRelative("2026-10-16T11:58:00Z", { now })).toBe("2 min ago");
    expect(formatRelative("2026-10-16T11:59:40Z", { now })).toBe("just now");
  });
  it("names today and falls back to the dated form", () => {
    expect(formatRelative("2026-10-16T08:05:00Z", { now })).toBe("Today 08:05 UTC");
    expect(formatRelative("2026-10-14T08:05:00Z", { now })).toBe("Oct 14, 08:05 UTC");
  });
});

describe("utcDayBounds", () => {
  it("is the UTC calendar day, the one the backend groups by", () => {
    const anchor = Date.parse("2026-10-16T23:59:00.000Z");
    expect(utcDayBounds(anchor)).toEqual({ from: "2026-10-16T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z" });
    expect(utcDayBounds(anchor, { offsetDays: -1 })).toEqual({
      from: "2026-10-15T00:00:00.000Z",
      to: "2026-10-16T00:00:00.000Z",
    });
  });

  it("matches the Today label's boundary", () => {
    const now = Date.parse("2026-11-01T12:00:00.000Z");
    const day = utcDayBounds(now);
    expect(formatDateTime(day.from, { now, alwaysDay: true })).toBe("Today 00:00 UTC");
    expect(formatDateTime(Date.parse(day.to) - 60_000, { now, alwaysDay: true })).toBe("Today 23:59 UTC");
  });
});

describe("utcDay", () => {
  const now = Date.parse("2026-10-16T00:10:00Z");
  it("heads per-day groups by the UTC day", () => {
    expect(utcDay("2026-10-16T00:05:00Z", { now })).toEqual({ key: "2026-10-16", label: "Today" });
    expect(utcDay("2026-10-15T23:55:00Z", { now })).toEqual({ key: "2026-10-15", label: "Yesterday" });
    expect(utcDay("2026-10-12T10:00:00Z", { now })).toEqual({ key: "2026-10-12", label: "Oct 12" });
  });
});
