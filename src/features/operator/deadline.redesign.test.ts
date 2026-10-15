import { describe, expect, it } from "vitest";

import { deadlineReading, timeLeftLabel } from "./deadline";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

describe("timeLeftLabel", () => {
  it("says the coarsest unit that still answers", () => {
    expect(timeLeftLabel(30_000)).toBe("Under a minute left");
    expect(timeLeftLabel(45 * 60_000)).toBe("45 min left");
    expect(timeLeftLabel(17 * HOUR + 59 * 60_000)).toBe("17h left");
    expect(timeLeftLabel(30 * HOUR)).toBe("30h left");
    expect(timeLeftLabel(3 * DAY + HOUR)).toBe("3 days left");
  });
});

describe("deadlineReading: approval", () => {
  it("is neutral while most of the 24 h is left", () => {
    const reading = deadlineReading("approval", iso(NOW + 17 * HOUR), iso(NOW - 7 * HOUR), NOW);
    expect(reading).toMatchObject({ label: "17h left", urgent: false, expired: false });
  });

  it("is urgent under a quarter of the window", () => {
    const reading = deadlineReading("approval", iso(NOW + 3 * HOUR), iso(NOW - 21 * HOUR), NOW);
    expect(reading).toMatchObject({ label: "3h left", urgent: true });
  });

  it("assumes a 24 h window when the start is unknown", () => {
    expect(deadlineReading("approval", iso(NOW + 5 * HOUR), null, NOW).urgent).toBe(true);
    expect(deadlineReading("approval", iso(NOW + 7 * HOUR), null, NOW).urgent).toBe(false);
  });

  it("says Expired once past, and No expiry when unreadable", () => {
    expect(deadlineReading("approval", iso(NOW - 1), null, NOW)).toMatchObject({ label: "Expired", expired: true, urgent: true });
    expect(deadlineReading("approval", "nope", null, NOW)).toMatchObject({ label: "No expiry", end: null });
  });
});

describe("deadlineReading: dispute", () => {
  it("is neutral early in the 30 days, with no date", () => {
    const reading = deadlineReading("dispute", iso(NOW + 26 * DAY), iso(NOW - 4 * DAY), NOW);
    expect(reading).toMatchObject({ label: "26 days left", urgent: false });
  });

  it("from day 20 is urgent and names the date to rule by", () => {
    const reading = deadlineReading("dispute", iso(NOW + 7 * DAY), iso(NOW - 23 * DAY), NOW, { timeZone: "UTC" });
    expect(reading).toMatchObject({ label: "7 days left · rule by Oct 23", urgent: true });
  });

  it("ends 30 days after the dispute when the expiry is missing", () => {
    const reading = deadlineReading("dispute", null, iso(NOW - 2 * DAY), NOW);
    expect(reading.label).toBe("28 days left");
    expect(reading.end).toBe(NOW + 28 * DAY);
  });

  it("says Expired without a date once past", () => {
    expect(deadlineReading("dispute", iso(NOW - HOUR), iso(NOW - 30 * DAY), NOW)).toMatchObject({ label: "Expired", expired: true });
  });
});
