import { describe, expect, it } from "vitest";

import { openWindowStanding } from "./standing";

const base = {
  verifiedCalls: 6,
  minVerifiedCalls: 400,
  projectedFailureRate: 1 / 6,
  toleranceAtClose: 0.0281,
  effectiveThresholdAtClose: 0.0781,
  projectedSampleAtClose: 400,
  declaredFailureRate: 0.05,
};

describe("open SLA window standing", () => {
  // BUG-R3-J-05: 6 of 400 verified calls, 1 failed, was shown as a red
  // "SLASHABLE · PROJECTED BREACH — has reached the sample gate".
  it("stays neutral below the sample gate even when the thin rate projects a breach", () => {
    const standing = openWindowStanding({
      ...base,
      state: "PROJECTED_BREACH",
      slashable: false,
      projectedBreach: true,
    });
    expect(standing.label).toBe("NOT YET SLASHABLE");
    expect(standing.tone).toBe("primary");
    expect(standing.sentence).toMatch(/^6 of 400 verified calls/);
    expect(standing.sentence).toMatch(/no penalty can come from this window/);
    expect(standing.sentence).not.toMatch(/has reached the sample gate/);
    expect(standing.projection).toMatch(/too few calls to judge$/);
    expect(standing.projection).not.toMatch(/breach likely/);
  });

  it("says slashable and projected breach only at the gate", () => {
    const standing = openWindowStanding({
      ...base,
      verifiedCalls: 400,
      state: "PROJECTED_BREACH",
      slashable: true,
      projectedBreach: true,
    });
    expect(standing.label).toBe("SLASHABLE · PROJECTED BREACH");
    expect(standing.tone).toBe("danger");
    expect(standing.sentence).toMatch(/has reached the sample gate/);
    expect(standing.projection).toMatch(/breach likely$/);
  });

  it("names the tolerance as part of the threshold, not of the projection", () => {
    const standing = openWindowStanding({
      ...base,
      verifiedCalls: 400,
      projectedFailureRate: 0.02,
      state: "WITHIN_SLA",
      slashable: true,
      projectedBreach: false,
    });
    expect(standing.label).toBe("SLASHABLE · WITHIN SLA");
    expect(standing.projection).toBe(
      "current rate 2.0%, held to close · effective threshold 7.8% at 400 calls (declared 5.0% + 2.8% tolerance) → breach unlikely"
    );
  });
});
