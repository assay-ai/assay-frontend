import { describe, expect, it } from "vitest";

import { slaReading, windowRange } from "./reading";

const base = { status: "OPEN" as const, verifiedCalls: 500, failedCalls: 8, minVerifiedCalls: 400, observedFailureRate: 0.016, declaredFailureRate: 0.02 };

describe("slaReading", () => {
  it("warns early in plain words", () => {
    const reading = slaReading(base, 0.02);
    expect(reading.headline).toBe("1.6% of calls failed this window (you promised at most 2%)");
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
