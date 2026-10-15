import { describe, expect, it } from "vitest";

import { economics, parseCalls, parsePrice, setupHref } from "./provider-economics";

describe("calculator inputs", () => {
  it("refuses garbage in words instead of turning it into $0", () => {
    expect(parsePrice("1.2.3").error).toBe("Enter a number like 0.001.");
    expect(parsePrice(".").error).toBe("Enter a number like 0.001.");
    expect(parsePrice("").error).toMatch(/Enter your price/);
    expect(parsePrice("0").error).toMatch(/above zero/);
    expect(parsePrice("1000").error).toMatch(/up to \$100/);
    expect(parsePrice("0.0000001").error).toMatch(/6 decimal places/);
    expect(parsePrice("0.001").value?.toString()).toBe("0.001");
  });
  it("accepts grouped call counts and caps them", () => {
    expect(parseCalls("1,000,000").value?.toString()).toBe("1000000");
    expect(parseCalls("12.5").error).toMatch(/whole number/);
    expect(parseCalls("2000000000").error).toMatch(/at most/);
  });
});

describe("economics", () => {
  it("free: no revenue, no stake, no risk", () => {
    const e = economics("FREE", null, null)!;
    expect(e.netPerMonth).toBe("$0.00");
    expect(e.stake).toBe("$0.00");
    expect(e.worstPerWindow).toBeNull();
  });
  it("paid: fee, net, stake and caps", () => {
    const e = economics("PAID", parsePrice("0.001").value, parseCalls("1000000").value)!;
    expect(e.perCall).toEqual({ price: "$0.001", fee: "$0.0001", youGet: "$0.0009" });
    expect(e.netPerMonth).toBe("$900.00");
    expect(e.stake).toBe("$50.00");
    expect(e.worstPerWindow).toBe("$5.00");
    expect(e.worstPer24h).toBe("$5.00");
    expect(e.daysToCoverStake).toBe("1.7");
  });
  it("needs valid numbers for a paid listing", () => {
    expect(economics("PAID", null, null)).toBeNull();
  });
  it("carries the numbers into setup", () => {
    expect(setupHref("PAID", "0.001", "1,000")).toBe("/provider/setup?mode=paid&price=0.001&calls=1000");
    expect(setupHref("FREE", "0.001", "x")).toBe("/provider/setup?mode=free");
  });
});
