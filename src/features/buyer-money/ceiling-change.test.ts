import { describe, expect, it } from "vitest";

import { ceilingChange } from "./caps";

/* Buyer retest 2026-10-16b: presets far below the current $10 / $120 said nothing about lowering it. */
describe("ceilingChange", () => {
  const current = { perCall: "10", perDay: "120" };

  it("says a preset below the current ceiling lowers it, from what to what", () => {
    expect(ceilingChange(current, { perCall: "0.50", perDay: "5" })).toBe(
      "lowers your ceiling from $10.00 to $0.50 a call and from $120.00 to $5.00 per 24 hours",
    );
  });

  it("says a raise, and a mixed change part by part", () => {
    expect(ceilingChange({ perCall: "1", perDay: "20" }, { perCall: "2", perDay: "40" })).toBe(
      "raises your ceiling from $1.00 to $2.00 a call and from $20.00 to $40.00 per 24 hours",
    );
    expect(ceilingChange(current, { perCall: "1", perDay: "200" })).toBe(
      "lowers your ceiling from $10.00 to $1.00 a call, and raises from $120.00 to $200.00 per 24 hours",
    );
    expect(ceilingChange(current, { perCall: "10", perDay: "20" })).toBe("lowers your ceiling from $120.00 to $20.00 per 24 hours");
  });

  it("says nothing with no ceiling yet, no change, or an unreadable number", () => {
    expect(ceilingChange(null, { perCall: "1", perDay: "20" })).toBeNull();
    expect(ceilingChange(current, { perCall: "10.00", perDay: "120" })).toBeNull();
    expect(ceilingChange(current, { perCall: "", perDay: "120" })).toBeNull();
  });
});
