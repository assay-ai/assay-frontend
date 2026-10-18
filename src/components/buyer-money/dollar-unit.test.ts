import { describe, expect, it } from "vitest";

import { dollarUnitNote } from "./dollar-unit";

describe("dollarUnitNote — one unit, $, with the stablecoin in a tooltip", () => {
  it("explains a stablecoin symbol", () => {
    expect(dollarUnitNote("USDG")).toBe("USDG is a dollar stablecoin: 1 USDG = $1");
  });

  it("needs no note for plain dollars or an unknown unit", () => {
    expect(dollarUnitNote("USD")).toBeNull();
    expect(dollarUnitNote("")).toBeNull();
    expect(dollarUnitNote(null)).toBeNull();
  });
});
