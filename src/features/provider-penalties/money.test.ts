import { describe, expect, it } from "vitest";

import { penaltyMoney } from "./money";

const usd = (amount: string) => ({ amount, asset: "USDG", decimals: 6 });

describe("penaltyMoney", () => {
  it("keeps three decimals under $0.10", () => {
    expect(penaltyMoney(usd("36000"))).toBe("$0.036");
    expect(penaltyMoney(usd("40000"))).toBe("$0.04");
    expect(penaltyMoney(usd("9000"))).toBe("$0.009");
    expect(penaltyMoney(usd("4000"))).toBe("$0.004");
  });

  it("writes two decimals from $0.10 up, truncated", () => {
    expect(penaltyMoney(usd("28470000"))).toBe("$28.47");
    expect(penaltyMoney(usd("1234567"))).toBe("$1.23");
    expect(penaltyMoney(usd("100000"))).toBe("$0.10");
  });
});
