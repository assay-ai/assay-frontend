import { describe, expect, it } from "vitest";

import { parseMonthlyCalls } from "./state";

describe("parseMonthlyCalls", () => {
  it("reads digits with optional thousands commas", () => {
    expect(parseMonthlyCalls("1000")).toBe(1000);
    expect(parseMonthlyCalls(" 1,000,000 ")).toBe(1_000_000);
    expect(parseMonthlyCalls("0")).toBe(0);
  });

  it("refuses what only Number() would read as a whole number", () => {
    for (const raw of ["1e3", "0x10", "12.0", "-5", "", "12 000", "99999999999999999999"]) {
      expect(parseMonthlyCalls(raw)).toBeNull();
    }
  });
});
