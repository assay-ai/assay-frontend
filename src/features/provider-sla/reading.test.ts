import { describe, expect, it } from "vitest";

import { checkWindowScope, recentWindows, slaReading, windowRange, windowRate } from "./reading";

const base = { status: "OPEN" as const, verifiedCalls: 500, failedCalls: 8, minVerifiedCalls: 400, observedFailureRate: 0.016, declaredFailureRate: 0.02 };

describe("slaReading", () => {
  it("warns early in plain words", () => {
    const reading = slaReading(base, 0.02);
    expect(reading.headline).toBe("In this check window, 1.6% of calls failed (you promised at most 2%)");
    expect(reading.tone).toBe("warning");
    expect(reading.sample).toBeNull();
  });

  it("says when there are too few calls instead of a red banner", () => {
    const reading = slaReading({ ...base, verifiedCalls: 6, failedCalls: 1, observedFailureRate: 1 / 6 }, 0.02);
    expect(reading.sample).toBe("Not enough calls yet (6 of 400)");
    expect(reading.tone).toBe("warning");
    expect(reading.advice).toMatch(/No penalty is possible/);
  });

  it("goes red only over the promise with enough calls", () => {
    expect(slaReading({ ...base, observedFailureRate: 0.03 }, 0.02).tone).toBe("danger");
    expect(slaReading({ ...base, observedFailureRate: 0.005 }, 0.02).tone).toBe("ok");
    expect(slaReading(null, 0.02).headline).toBeNull();
  });
});

describe("windowRange", () => {
  it("names a window by its dates", () => {
    const options = { timeZone: "UTC", now: Date.parse("2026-10-16T00:00:00Z") };
    expect(
      windowRange({ status: "CLOSED", openedAt: "2026-10-13T15:00:00Z", closedAt: "2026-10-13T17:00:00Z", deadlineAt: "" }, options),
    ).toBe("Oct 13, 15:00 – 17:00");
    expect(windowRange({ status: "OPEN", openedAt: "2026-10-13T15:00:00Z", closedAt: null, deadlineAt: "" }, options)).toBe(
      "Since Oct 13, 15:00",
    );
  });
});

describe("recentWindows", () => {
  const w = (windowId: string, bindingId: string, status: "OPEN" | "CLOSED", openedAt: string) => ({ windowId, bindingId, status, openedAt });
  it("keeps one tool's windows, newest first, with at most one open", () => {
    const out = recentWindows(
      [
        w("a", "b1", "CLOSED", "2026-10-07T00:00:00Z"),
        w("x", "b2", "OPEN", "2026-10-15T00:00:00Z"),
        w("c", "b1", "OPEN", "2026-10-14T00:00:00Z"),
        w("d", "b1", "OPEN", "2026-10-01T00:00:00Z"),
        w("e", "b1", "CLOSED", "2026-09-30T00:00:00Z"),
      ],
      "b1",
    );
    expect(out.map((x) => x.windowId)).toEqual(["c", "a", "e"]);
  });

  it("states a window's rate", () => {
    expect(windowRate({ observedFailureRate: 0.0139, verifiedCalls: 431 })).toBe("1.4%");
    expect(windowRate({ observedFailureRate: null, verifiedCalls: 0 })).toBeNull();
  });
});

describe("checkWindowScope (final2 P3: label every failure rate with its window)", () => {
  const now = Date.parse("2026-10-17T10:00:00Z");
  it("counts an open window from when it opened", () => {
    expect(checkWindowScope({ status: "OPEN", openedAt: "2026-10-13T10:00:00Z" }, now)).toBe("this check window (last 4 days)");
    expect(checkWindowScope({ status: "OPEN", openedAt: "2026-10-17T04:00:00Z" }, now)).toBe("this check window (last 6 h)");
    expect(checkWindowScope({ status: "OPEN" }, now)).toBe("this check window");
  });
  it("gives a closed window its length", () => {
    expect(checkWindowScope({ status: "CLOSED", openedAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-08T10:00:00Z" }, now)).toBe(
      "the last check window (7 days)",
    );
  });
  it("puts the window in the headline", () => {
    const reading = slaReading({ ...base, openedAt: "2026-10-16T10:00:00Z" }, 0.02, { now });
    expect(reading.headline).toBe("In this check window (last 1 day), 1.6% of calls failed (you promised at most 2%)");
  });
});
