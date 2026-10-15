import { describe, expect, it } from "vitest";

import { verdictChip, verdictFilterStatuses } from "./present";

describe("verdict presentation", () => {
  it("defaults to every call", () => {
    expect(verdictFilterStatuses("all")).toBeUndefined();
    expect(verdictFilterStatuses("failed")).toEqual(["FAIL", "MISAPPLIED"]);
  });

  it("never paints a not-applicable call red", () => {
    for (const status of ["SKIPPED", "EMPTY_UNVERIFIED", "MISAPPLIED", null] as const) {
      expect(verdictChip(status).className).not.toMatch(/danger/);
    }
    expect(verdictChip("FAIL").className).toMatch(/danger/);
  });
});
