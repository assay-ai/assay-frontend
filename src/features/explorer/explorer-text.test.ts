import { describe, expect, it } from "vitest";

import {
  checkSentences,
  failRateLabel,
  formatCallPrice,
  freeTierLabel,
  moneyByAsset,
  plural,
  priceSentence,
  shortDay,
  smallestFreeAllowance,
  stakeSummary,
} from "./explorer-text";

const usd = (amount: string) => ({ amount, asset: "eip155:1/erc20:0xabc", decimals: 6 });

describe("formatCallPrice", () => {
  it("keeps sub-cent prices readable", () => {
    expect(formatCallPrice(usd("1000"))).toBe("$0.001");
    expect(formatCallPrice(usd("5"))).toBe("$0.000005");
  });
  it("uses two decimals from a cent up, more only when needed", () => {
    expect(formatCallPrice(usd("250000"))).toBe("$0.25");
    expect(formatCallPrice(usd("1000000"))).toBe("$1.00");
    expect(formatCallPrice(usd("12300"))).toBe("$0.0123");
  });
  it("says Free for zero and a dash for unknown", () => {
    expect(formatCallPrice(usd("0"))).toBe("Free");
    expect(formatCallPrice(null)).toBe("—");
  });
});

describe("free tier", () => {
  it("labels the badge with the allowance when known", () => {
    expect(freeTierLabel("FREEMIUM", 100)).toBe("Free · 100 calls/day");
    expect(freeTierLabel("FREEMIUM", null)).toBe("Free tier");
    expect(freeTierLabel("FREE")).toBe("Free");
    expect(freeTierLabel("PAID", 100)).toBeNull();
  });
  it("takes the smallest allowance offered", () => {
    expect(smallestFreeAllowance([null, 250, 100])).toBe(100);
    expect(smallestFreeAllowance([null, 0])).toBeNull();
  });
});

describe("priceSentence", () => {
  it("states the pay-only-if-it-passes promise", () => {
    expect(priceSentence({ mode: "PAID", price: usd("1000") })).toBe(
      "$0.001 per call. You pay only if the result passes the check.",
    );
    expect(priceSentence({ mode: "FREEMIUM", price: usd("1000"), freeCallsPerDay: 100 })).toContain(
      "The first 100 calls each day are free for each agent",
    );
    expect(priceSentence({ mode: "PAID", price: null })).toContain("no provider is serving it");
  });
});

describe("failRateLabel", () => {
  it("never invents a rate from nothing", () => {
    expect(failRateLabel(null)).toBe("Not measured yet");
    expect(failRateLabel({ measuredCalls: 0, failedCalls: 0 })).toBe("Not measured yet");
  });
  it("shows the share that failed and the sample size", () => {
    expect(failRateLabel({ measuredCalls: 400, failedCalls: 8 })).toBe("2.0% failed · 400 calls checked");
    expect(failRateLabel({ measuredCalls: 1, failedCalls: 0 })).toBe("0% failed · 1 call checked");
  });
});

describe("stakeSummary", () => {
  it("lists each chain, never a sum, and says when it is unknown", () => {
    const name = (id: string) => (id === "eip155:1" ? "Ethereum" : id);
    expect(stakeSummary([], name)).toBe("Stake not known");
    expect(
      stakeSummary(
        [
          { ...usd("90000000"), chainId: "eip155:1" },
          { ...usd("40000000"), chainId: "solana:x" },
        ],
        name,
      ),
    ).toBe("$90.00 on Ethereum · $40.00 on solana:x");
  });
});

describe("misc", () => {
  it("explains checks by tier", () => {
    expect(checkSentences("GUARANTEED")).toHaveLength(2);
    expect(checkSentences("UNVERIFIED")).toHaveLength(1);
  });
  it("pluralises", () => {
    expect(plural(1, "call")).toBe("1 call");
    expect(plural(1200, "call")).toBe("1,200 calls");
  });
  it("groups money per asset", () => {
    expect(moneyByAsset([usd("1"), usd("2"), { ...usd("5"), asset: "other" }])).toEqual([
      usd("3"),
      { ...usd("5"), asset: "other" },
    ]);
  });
  it("formats a UTC day", () => {
    expect(shortDay("2026-10-14")).toBe("14 Oct");
  });
});
