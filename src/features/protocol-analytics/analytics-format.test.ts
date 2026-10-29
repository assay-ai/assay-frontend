import { describe, expect, it } from "vitest";
import {
  analyticsMoney,
  analyticsRate,
  analyticsChange,
} from "./analytics-format";

const asset = {
  id: "asset",
  chainId: "chain",
  chainName: "Chain",
  symbol: "USDG",
  decimals: 6,
};
describe("analytics amounts", () => {
  it("keeps unavailable separate from zero and formats atomic amounts exactly", () => {
    expect(analyticsMoney(undefined, asset)).toBe("—");
    expect(analyticsMoney("0", asset)).toBe("0.00 USDG");
    expect(analyticsMoney("100000000000000000001", asset)).toBe(
      "100,000,000,000,000.000001 USDG",
    );
    expect(analyticsMoney("1", asset)).toBe("0.000001 USDG");
    expect(analyticsRate(null)).toBe("—");
    expect(analyticsRate(0)).toBe("0.0%");
  });
  it("does not invent growth when the previous amount is zero", () => {
    expect(analyticsChange("100", "0")).toBeUndefined();
    expect(analyticsChange("100", null)).toBeUndefined();
    expect(analyticsChange("150", "100")).toBe("▲ 50.0% vs previous period");
  });
});
