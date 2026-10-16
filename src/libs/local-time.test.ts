import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatLocalDate,
  formatLocalDateTime,
  formatRelative,
  localDayBounds,
  utcTitle,
  zoneLabel,
} from "./local-time";

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

  it("writes the day words in lowercase inside a sentence", () => {
    const mid = { ...UTC, midSentence: true };
    expect(formatLocalDateTime("2026-10-15T07:20:00Z", { ...mid, alwaysDay: true })).toBe("today 07:20");
    expect(formatLocalDateTime("2026-10-14T23:05:00Z", mid)).toBe("yesterday 23:05");
    expect(formatLocalDateTime("2026-10-16T14:20:00Z", mid)).toBe("tomorrow 14:20");
    expect(formatLocalDateTime("2026-10-20T14:20:00Z", mid)).toBe("Oct 20, 14:20");
    expect(formatRelative("2026-10-15T08:05:00Z", mid)).toBe("today 08:05");
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

describe("zoneLabel", () => {
  it("names the zone a time is shown in", () => {
    expect(zoneLabel("2026-10-16T12:00:00Z", { timeZone: "UTC" })).toBe("UTC");
    expect(zoneLabel("2026-07-01T12:00:00Z", { timeZone: "Europe/London" })).toBe("GMT+1");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  it("says minutes ago within the hour", () => {
    expect(formatRelative("2026-10-16T11:58:00Z", { now, timeZone: "UTC" })).toBe("2 min ago");
    expect(formatRelative("2026-10-16T11:59:40Z", { now, timeZone: "UTC" })).toBe("just now");
  });
  it("names today and falls back to the dated form", () => {
    expect(formatRelative("2026-10-16T08:05:00Z", { now, timeZone: "UTC" })).toBe("Today 08:05");
    expect(formatRelative("2026-10-14T08:05:00Z", { now, timeZone: "UTC" })).toBe("Oct 14, 08:05");
  });
});

describe("localDayBounds (review 2026-10-17 P3)", () => {
  it("is the reader's own calendar day, not the UTC one", () => {
    // 01:00 on Oct 17 in GMT+9 is still Oct 16 in UTC.
    const anchor = Date.parse("2026-10-16T18:00:00.000Z");
    expect(localDayBounds(anchor, { timeZone: "Asia/Tokyo" })).toEqual({
      from: "2026-10-16T17:00:00.000Z",
      to: "2026-10-17T17:00:00.000Z",
    });
    expect(localDayBounds(anchor, { timeZone: "Asia/Tokyo", offsetDays: -1 })).toEqual({
      from: "2026-10-15T17:00:00.000Z",
      to: "2026-10-16T17:00:00.000Z",
    });
    expect(localDayBounds(anchor, { timeZone: "UTC" })).toEqual({
      from: "2026-10-16T00:00:00.000Z",
      to: "2026-10-17T00:00:00.000Z",
    });
  });

  it("matches the Today label's boundary, west of Greenwich and across a DST change", () => {
    const ny = localDayBounds(Date.parse("2026-11-01T12:00:00.000Z"), { timeZone: "America/New_York" });
    // Nov 1, 2026 is the fall-back day: 25 hours long.
    expect(ny).toEqual({ from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z" });
    const now = Date.parse("2026-11-01T12:00:00.000Z");
    expect(formatLocalDateTime(ny.from, { timeZone: "America/New_York", now, alwaysDay: true })).toBe("Today 00:00");
  });
});
