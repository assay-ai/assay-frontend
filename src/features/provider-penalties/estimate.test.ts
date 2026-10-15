import { describe, expect, it } from "vitest";

import { estimatePenalty, exampleFailureRate } from "./estimate";

const usd = (amount: string) => ({ amount, asset: "x", decimals: 6 });

describe("estimatePenalty", () => {
  it("is the formula result, with no per-window cap (none is enforced)", () => {
    // 1,000 × $0.30 = $300 × 9% × 2 = $54. No max($5, 100 × price) cap: the chain has none.
    const result = estimatePenalty({ price: usd("300000"), calls: 1000, observedRate: 0.12, declaredRate: 0.03 });
    expect(result.penalty.amount).toBe("54000000");
    expect(result).not.toHaveProperty("capped");
  });

  it("works for cheap tools", () => {
    // 1,000 × $0.01 = $10 × 2% × 2 = $0.40.
    const result = estimatePenalty({ price: usd("10000"), calls: 1000, observedRate: 0.05, declaredRate: 0.03 });
    expect(result.penalty.amount).toBe("400000");
  });

  it("is zero within the promise", () => {
    expect(estimatePenalty({ price: usd("300000"), calls: 1000, observedRate: 0.02, declaredRate: 0.03 }).penalty.amount).toBe("0");
  });
});

describe("exampleFailureRate", () => {
  it("is 12% unless the promise is already that high", () => {
    expect(exampleFailureRate(0.03)).toBe(0.12);
    expect(exampleFailureRate(0.15)).toBe(0.2);
  });
});
