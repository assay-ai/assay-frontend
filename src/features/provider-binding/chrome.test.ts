import { describe, expect, it } from "vitest";

import { dailyCallsFromInput, minorUnitsFromMajorInput, priceModeError } from "./chrome";

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

describe("priceModeError", () => {
  it.each(["PAID", "FREEMIUM"])("refuses zero and empty on %s", (mode) => {
    expect(priceModeError(mode, "0", "0")).not.toBeNull();
    expect(priceModeError(mode, "0.000000", "0")).not.toBeNull();
    expect(priceModeError(mode, "", null)).not.toBeNull();
  });

  it("accepts a positive price on a charging mode", () => {
    expect(priceModeError("PAID", "0.25", "250000")).toBeNull();
  });

  it("allows zero on FREE", () => {
    expect(priceModeError("FREE", "0", "0")).toBeNull();
    expect(priceModeError("FREE", "", null)).toBeNull();
  });
});

describe("dailyCallsFromInput", () => {
  it("reads a whole number of calls, with no money conversion", () => {
    expect(dailyCallsFromInput("80")).toEqual({ value: 80, error: null });
    expect(dailyCallsFromInput(" 5000 ")).toEqual({ value: 5000, error: null });
  });

  it("treats an empty box as the platform default", () => {
    expect(dailyCallsFromInput("")).toEqual({ value: null, error: null });
  });

  it("refuses decimals, zero and values above the backend's maximum", () => {
    expect(dailyCallsFromInput("0.5").error).toBe("Whole numbers only.");
    expect(dailyCallsFromInput("0").error).toMatch(/At least 1/);
    expect(dailyCallsFromInput("2147483648").error).toBe("Too large.");
    expect(dailyCallsFromInput("2147483647")).toEqual({ value: 2147483647, error: null });
  });
});
