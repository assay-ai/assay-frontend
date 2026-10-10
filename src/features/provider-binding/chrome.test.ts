import { describe, expect, it } from "vitest";

import { minorUnitsFromMajorInput } from "./chrome";

describe("minorUnitsFromMajorInput", () => {
  it.each([".", "1.2.3", "abc", "-1", "1e3"])("rejects %j without throwing", (text) => {
    const result = minorUnitsFromMajorInput(text, 6);
    expect(result.amount).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("treats empty text as no value", () => {
    expect(minorUnitsFromMajorInput("", 6)).toEqual({ amount: null, error: null });
    expect(minorUnitsFromMajorInput("  ", 6)).toEqual({ amount: null, error: null });
  });

  it("accepts a trailing or leading point", () => {
    expect(minorUnitsFromMajorInput("5.", 6)).toEqual({ amount: "5000000", error: null });
    expect(minorUnitsFromMajorInput(".5", 6)).toEqual({ amount: "500000", error: null });
  });

  it("refuses too many decimals and unsafe integers", () => {
    expect(minorUnitsFromMajorInput("0.1234567", 6).error).toMatch(/decimal places/);
    expect(minorUnitsFromMajorInput("9007199254.740993", 6).error).toBe("Too large.");
    expect(minorUnitsFromMajorInput("9007199254.740991", 6).error).toBeNull();
  });
});
