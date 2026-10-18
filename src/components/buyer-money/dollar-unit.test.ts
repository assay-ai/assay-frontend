import { describe, expect, it } from "vitest";

import { dollarUnitNote, dollarUnitText } from "./dollar-unit";

describe("dollar unit — $ for dollars and dollar stablecoins only", () => {
  it("shows $ with a note for a dollar stablecoin", () => {
    expect(dollarUnitText("USDG")).toBe("$");
    expect(dollarUnitNote("USDG")).toBe("USDG is a dollar stablecoin: 1 USDG = $1");
    expect(dollarUnitText("USDC")).toBe("$");
  });

  it("shows $ with no note for plain dollars or an unknown unit", () => {
    expect(dollarUnitText("USD")).toBe("$");
    expect(dollarUnitNote("USD")).toBeNull();
    expect(dollarUnitText(null)).toBe("$");
    expect(dollarUnitNote("")).toBeNull();
  });

  it("never gives another asset a dollar sign (review m3)", () => {
    expect(dollarUnitText("SOL")).toBe("SOL");
    expect(dollarUnitNote("SOL")).toBeNull();
    expect(dollarUnitText("ETH")).toBe("ETH");
  });
});
