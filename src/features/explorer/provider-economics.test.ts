import { describe, expect, it } from "vitest";

import type { ChainParams } from "@/interfaces/chain";

import { coverTimeText, economics, economicsTerms, parseCalls, parsePrice, setupHref } from "./provider-economics";

const PARAMS = { takeRateBps: 1000, minimumStake: "50000000", slashCapBps: 1000 } as ChainParams;
const TERMS = economicsTerms(PARAMS, 6);

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
    const e = economics("FREE", null, null, null)!;
    expect(e.netPerMonth).toBe("$0.00");
    expect(e.stake).toBe("$0.00");
    expect(e.worstPer24h).toBeNull();
  });
  it("paid: fee, net, stake and caps", () => {
    const e = economics("PAID", parsePrice("0.001").value, parseCalls("1000000").value, TERMS)!;
    expect(e.perCall).toEqual({ price: "$0.001", fee: "$0.0001", youGet: "$0.0009" });
    expect(e.netPerMonth).toBe("$900.00");
    expect(e.stake).toBe("$50.00");
    expect(e).not.toHaveProperty("worstPerWindow");
    expect(e.worstPer24h).toBe("$5.00");
    expect(e.daysToCoverStake).toBe("1.7");
  });
  it("needs valid numbers for a paid listing", () => {
    expect(economics("PAID", null, null, TERMS)).toBeNull();
  });
  it("shows nothing for a paid listing until the chain terms are known", () => {
    expect(economics("PAID", parsePrice("0.001").value, parseCalls("1000").value, null)).toBeNull();
    expect(economicsTerms({ ...PARAMS, takeRateBps: null }, 6)).toBeNull();
  });
  it("follows the chain's fee, minimum stake and daily cap", () => {
    const terms = economicsTerms({ takeRateBps: 2000, minimumStake: "100000000", slashCapBps: 500 } as ChainParams, 6);
    const e = economics("PAID", parsePrice("0.001").value, parseCalls("1000000").value, terms)!;
    expect(e.perCall).toEqual({ price: "$0.001", fee: "$0.0002", youGet: "$0.0008" });
    expect(e.stake).toBe("$100.00");
    expect(e.worstPer24h).toBe("$5.00");
  });
  it("carries the numbers into setup", () => {
    expect(setupHref("PAID", "0.001", "1,000")).toBe("/provider/setup?mode=paid&price=0.001&calls=1000");
    expect(setupHref("FREE", "0.001", "x")).toBe("/provider/setup?mode=free");
  });
});

describe("coverTimeText", () => {
  it("reads in days, years, or a cap", () => {
    expect(coverTimeText("1.7")).toBe("≈ 1.7 days of earnings");
    expect(coverTimeText("1200")).toBe("≈ 3.3 years of earnings");
    expect(coverTimeText("365")).toBe("≈ 365 days of earnings");
    expect(coverTimeText("366")).toBe("≈ 1 year of earnings");
    expect(coverTimeText("3650")).toBe("≈ 10 years of earnings");
    expect(coverTimeText("3651")).toBe("more than 10 years of earnings");
    expect(coverTimeText("1666666.7")).toBe("more than 10 years of earnings");
  });
});
