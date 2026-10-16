import { describe, expect, it } from "vitest";

import {
  checkSentences,
  explorerHref,
  hasFreeCalls,
  readExplorerState,
  routingNotes,
  failRateLabel,
  failsOften,
  heldPriceSentence,
  priceRange,
  formatCallPrice,
  freeTierLabel,
  moneyByAsset,
  offerLine,
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
    expect(stakeSummary([], name)).toBe("Could not be read just now");
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

describe("failsOften and priceRange", () => {
  const usd = (amount: string) => ({ amount, asset: "a", decimals: 6 });
  it("flags at least 20% failures over at least 5 calls only", () => {
    expect(failsOften({ measuredCalls: 8, failedCalls: 8 })).toBe(true);
    expect(failsOften({ measuredCalls: 10, failedCalls: 2 })).toBe(true);
    expect(failsOften({ measuredCalls: 10, failedCalls: 1 })).toBe(false);
    expect(failsOften({ measuredCalls: 4, failedCalls: 4 })).toBe(false);
    expect(failsOften(null)).toBe(false);
  });
  it("says from the cheapest eligible price, held at the quote", () => {
    const range = priceRange(usd("12000"), [usd("8000"), usd("11000"), usd("12000")]);
    expect(range?.from.amount).toBe("8000");
    expect(range?.differs).toBe(true);
    expect(heldPriceSentence(range!)).toMatch(/held at most \$0\.012; you pay the price of the provider that served/);
  });
  it("ignores listings priced above the hold (not routed) and reports one price", () => {
    const range = priceRange(usd("100000"), [usd("100000"), usd("250000")]);
    expect(range?.differs).toBe(false);
    expect(heldPriceSentence(range!)).toBeNull();
  });
});

describe("routingNotes", () => {
  const usd = (major: string) => ({ amount: String(Math.round(Number(major) * 1_000_000)), asset: "usd", decimals: 6 });
  it("names a provider priced above the hold and says why it gets no paid calls", () => {
    const notes = routingNotes(usd("0.10"), [
      { name: "Cheap Co", price: usd("0.10"), quality: null },
      { name: "Dear Co", price: usd("0.25"), quality: null },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Dear Co ($0.25 a call) is not taking paid calls right now");
  });
  it("says the only provider taking calls fails often, and that failures are never charged", () => {
    const notes = routingNotes(usd("0.10"), [
      { name: "Flaky", price: usd("0.10"), quality: { measuredCalls: 8, failedCalls: 8 } },
      { name: "Dear Co", price: usd("0.25"), quality: null },
    ]);
    expect(notes[1]).toBe(
      "Calls go to the provider that is taking calls; this one has failed often recently. Failed results are never charged.",
    );
  });
  it("says nothing when every provider takes calls and none fails often", () => {
    expect(routingNotes(usd("0.10"), [{ name: "A", price: usd("0.10"), quality: null }])).toEqual([]);
  });
});

describe("routingNotes across chains", () => {
  const evm = { amount: "100000", asset: "eip155:46630/erc20:0xusdg", decimals: 6 };
  const sol = { amount: "250000", asset: "solana:devnet/token:usdg", decimals: 6 };
  const names: Record<string, string> = { "eip155:46630": "Robinhood Chain testnet", "solana:devnet": "Solana devnet" };
  it("says a provider priced on another chain is on that chain, not idle", () => {
    const notes = routingNotes(
      evm,
      [
        { name: "E2E Weather", price: evm, quality: null },
        { name: "Open-Meteo", price: sol, quality: null },
      ],
      (id) => names[id] ?? id,
    );
    expect(notes).toEqual(["The price above is for Robinhood Chain testnet. Open-Meteo charges $0.25 a call on Solana devnet."]);
  });
});

describe("Explorer list state in the URL", () => {
  it("round-trips view, search and the free filter, leaving defaults out", () => {
    expect(explorerHref({ view: "tools", q: "", free: false })).toBe("/catalogue");
    const href = explorerHref({ view: "tools", q: "weather now", free: true });
    expect(href).toBe("/catalogue?q=weather+now&free=1");
    expect(readExplorerState(new URLSearchParams(href.split("?")[1]))).toEqual({ view: "tools", q: "weather now", free: true });
    expect(explorerHref({ view: "providers", q: "", free: true })).toBe("/catalogue?view=providers");
    expect(readExplorerState(new URLSearchParams(""))).toEqual({ view: "tools", q: "", free: false });
  });

  it("counts free and free-tier tools as having free calls", () => {
    expect(hasFreeCalls("FREE")).toBe(true);
    expect(hasFreeCalls("FREEMIUM")).toBe(true);
    expect(hasFreeCalls("PAID")).toBe(false);
  });
});

/**
 * Free first, then paid — the intent of main's QuoteCell test (catalogue
 * free-first and "up to only over paid bindings"), on this explorer's own
 * price words.
 */
describe("free first, then paid", () => {
  it("does not make a range of a free listing beside one paid listing", () => {
    const range = priceRange(usd("20000"), [usd("0"), usd("20000")]);
    expect(range?.differs).toBe(false);
    expect(heldPriceSentence(range!)).toBeNull();
  });

  it("still reads a range over two paid listings", () => {
    expect(priceRange(usd("20000"), [usd("10000"), usd("20000")])?.differs).toBe(true);
  });

  it("leads a FREEMIUM tool with its free calls per day, then the price", () => {
    expect(freeTierLabel("FREEMIUM", 100)).toBe("Free · 100 calls/day");
    const sentence = priceSentence({ mode: "FREEMIUM", price: usd("20000"), freeCallsPerDay: 150 });
    expect(sentence).toMatch(/^The first 150 calls each day are free/);
    expect(sentence).toMatch(/even when other providers charge/);
    expect(sentence).toMatch(/after that \$0\.02 per call/);
  });

  it("says nothing free for a PAID tool", () => {
    expect(freeTierLabel("PAID", 100)).toBeNull();
    expect(priceSentence({ mode: "PAID", price: usd("20000") })).not.toMatch(/free/);
  });
});

describe("offerLine", () => {
  const one = priceRange(usd("2000"), [usd("2000")]);
  const two = priceRange(usd("3000"), [usd("2000"), usd("3000")]);
  const freeBeside = priceRange(usd("2000"), [usd("0"), usd("2000")]);

  it("merges the free tier and the price into one line, free first", () => {
    const line = offerLine({ mode: "FREEMIUM", range: one, freeCallsPerDay: 100 });
    expect(line.text).toBe("Free for 100 calls/day, then $0.002/call");
    expect(line.lead).toBe("Free for 100 calls/day, then");
    expect(line.price).toBe("$0.002");
    expect(line.unit).toBe("/call");
  });

  it("says 'from' only over paid listings that differ", () => {
    expect(offerLine({ mode: "FREEMIUM", range: two, freeCallsPerDay: 1500 }).text).toBe(
      "Free for 1,500 calls/day, then from $0.002/call",
    );
    expect(offerLine({ mode: "PAID", range: freeBeside }).text).toBe("$0.002/call");
    expect(offerLine({ mode: "PAID", range: two }).text).toBe("from $0.002/call");
  });

  it("does not invent an allowance it does not know", () => {
    expect(offerLine({ mode: "FREEMIUM", range: one, freeCallsPerDay: null }).text).toBe("Free tier, then $0.002/call");
  });

  it("reads Free for a free tool, and a dash when nothing can be priced", () => {
    expect(offerLine({ mode: "FREE", range: one })).toEqual({ lead: null, price: "Free", unit: "", text: "Free" });
    expect(offerLine({ mode: "PAID", range: null }).text).toBe("—");
    expect(offerLine({ mode: "FREEMIUM", range: null, freeCallsPerDay: 100 }).text).toBe(
      "Free tier; paid calls not available right now",
    );
  });
});
