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
  costSentence,
  offerLine,
  offerSubLine,
  notChargedEmptyText,
  notChargedPrivacyNote,
  notChargedRowText,
  notChargedReasonTones,
  notChargedSplit,
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
    expect(freeTierLabel("FREEMIUM", 100)).toBe("Free · 100 calls/day per agent");
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
    expect(stakeSummary([], name)).toBe("Not available yet");
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
    expect(notes[0]).toContain("Dear Co ($0.25 per call) is not taking paid calls right now");
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
    expect(notes).toEqual(["The price above is for Robinhood Chain testnet. Open-Meteo charges $0.25 per call on Solana devnet."]);
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
    expect(freeTierLabel("FREEMIUM", 100)).toBe("Free · 100 calls/day per agent");
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
    expect(line.text).toBe("Free for 100 calls/day per agent, then $0.002 per call");
    expect(line.lead).toBe("Free for 100 calls/day per agent, then");
    expect(line.price).toBe("$0.002");
    expect(line.unit).toBe(" per call");
  });

  it("says 'from' only over paid listings that differ", () => {
    expect(offerLine({ mode: "FREEMIUM", range: two, freeCallsPerDay: 1500 }).text).toBe(
      "Free for 1,500 calls/day per agent, then from $0.002 per call",
    );
    expect(offerLine({ mode: "PAID", range: freeBeside }).text).toBe("$0.002 per call");
    expect(offerLine({ mode: "PAID", range: two }).text).toBe("from $0.002 per call");
  });

  it("does not invent an allowance it does not know", () => {
    expect(offerLine({ mode: "FREEMIUM", range: one, freeCallsPerDay: null }).text).toBe("Free tier, then $0.002 per call");
  });

  it("reads Free for a free tool, and a dash when nothing can be priced", () => {
    expect(offerLine({ mode: "FREE", range: one })).toEqual({ lead: null, price: "Free", unit: "", text: "Free" });
    expect(offerLine({ mode: "PAID", range: null }).text).toBe("—");
    // The sentence is the lead, never set in the price slot.
    expect(offerLine({ mode: "FREEMIUM", range: null, freeCallsPerDay: 100 })).toEqual({
      lead: "Free tier; paid calls not available right now",
      price: "",
      unit: "",
      text: "Free tier; paid calls not available right now",
    });
  });
});

describe("costSentence and offerSubLine (public catalogue, free first)", () => {
  const two = priceRange(usd("30000"), [usd("20000"), usd("30000")]);
  const one = priceRange(usd("20000"), [usd("0"), usd("20000")]);

  it("keeps the free-first sentence before the range for a FREEMIUM tool", () => {
    const text = costSentence({ mode: "FREEMIUM", price: usd("30000"), range: two, freeCallsPerDay: 100 });
    expect(text).toMatch(/^The first 100 calls each day are free/);
    // The price after the free calls depends on who serves it: the range, never the dearest alone.
    expect(text).toMatch(/the price of the provider that serves it, from \$0\.02 to \$0\.03/);
    expect(text).not.toMatch(/after that \$0\.03 per call/);
    expect(text).toMatch(/held at most \$0\.03 per call/);
  });

  it("keeps one price after the free calls when the paid listings agree", () => {
    const text = costSentence({ mode: "FREEMIUM", price: usd("20000"), range: one, freeCallsPerDay: 100 });
    expect(text).toMatch(/after that \$0\.02 per call/);
    expect(text).not.toMatch(/held at most/);
  });

  it("uses the range alone for a PAID tool, and the price sentence without one", () => {
    expect(costSentence({ mode: "PAID", price: usd("30000"), range: two })).toMatch(/^Providers charge from/);
    expect(costSentence({ mode: "PAID", price: usd("20000"), range: one })).toBe(
      "$0.02 per call. You pay only if the result passes the check.",
    );
  });

  it("says 'after the free calls' under a FREEMIUM price, and the hold over a range", () => {
    expect(offerSubLine("FREEMIUM", one)).toBe("after the free calls, only if it passes");
    expect(offerSubLine("PAID", one)).toBe("paid only if it passes");
    expect(offerSubLine("FREEMIUM", two)).toBe("held at most $0.03, paid only if it passes");
    expect(offerSubLine("FREE", one)).toBe("");
    expect(offerSubLine("PAID", null)).toBe("");
  });

  it("prints no range over a single paid listing when paidBindings says one", () => {
    const paidBindings = 1;
    const range = priceRange(usd("30000"), paidBindings > 1 ? [usd("20000")] : []);
    expect(range?.differs).toBe(false);
  });
});

describe("notChargedEmptyText", () => {
  it("always says something when no row is listed, without claiming nothing happened behind the privacy rule", () => {
    expect(notChargedEmptyText(true, false)).toBe("No call to this tool went uncharged recently.");
    expect(notChargedEmptyText(true, true)).toBe("No uncharged call to this tool can be listed right now.");
    expect(notChargedEmptyText(false, true)).toBe("No uncharged call can be listed right now.");
    expect(notChargedEmptyText(false, false)).toBe("No call went uncharged in this period.");
    expect(notChargedEmptyText("provider", false)).toBe("No call to their tools went uncharged recently.");
    expect(notChargedEmptyText("provider", true)).toBe("No uncharged call to their tools can be listed right now.");
    expect(notChargedEmptyText("tool", true)).toBe(notChargedEmptyText(true, true));
  });
});

describe("notChargedRowText (public not-charged feed)", () => {
  it("tags each row with the same label and tone as its reason's count line", () => {
    const keys = ["PROVIDER_ERROR", "REQUEST_REJECTED", "NO_USABLE_RESULT", "OUT_OF_SCOPE", "EXPIRED", "NOT_COLLECTED"];
    const lines = notChargedSplit({
      callsNotCharged: 70,
      callsFailedCheck: 10,
      notChargedByReason: keys.map((reason) => ({ reason, calls: 10 })),
      callsNotChargedOther: 0,
    });
    for (const line of lines) {
      const row = notChargedRowText({
        reason: line.key,
        reasonText: "A sentence.",
        bucket: line.key === "FAILED_CHECK" ? "FAILED_VERIFICATION" : "PROVIDER_OR_PLATFORM_ERROR",
      });
      expect([row.tag, row.tone]).toEqual([line.label, line.tone]);
    }
  });

  it("says 'Payment not collected' for NOT_COLLECTED, with the server's sentence", () => {
    const row = notChargedRowText({
      reason: "NOT_COLLECTED",
      reasonText: "Payment for this call was not collected, so the buyer was not charged.",
      bucket: "PROVIDER_OR_PLATFORM_ERROR",
    });
    expect(row.tag).toBe("Payment not collected");
    expect(row.text).toBe("Payment for this call was not collected, so the buyer was not charged.");
  });

  it("keeps the guarantee firing apart, including a voided debt sent as FAILED_CHECK", () => {
    const row = notChargedRowText({ reason: "FAILED_CHECK", reasonText: "The result failed our check.", bucket: "FAILED_VERIFICATION" });
    expect(row).toEqual({ tag: "Result failed our check", tone: "teal", text: "The result failed our check." });
  });

  it("names an unknown reason neutrally, with the server's sentence", () => {
    expect(notChargedRowText({ reason: "SOMETHING_NEW", reasonText: "A new plain sentence.", bucket: "PROVIDER_OR_PLATFORM_ERROR" })).toEqual({
      tag: "Another reason",
      tone: "neutral",
      text: "A new plain sentence.",
    });
  });
});

describe("notChargedSplit (public not-charged totals)", () => {
  it("lists each reason the server named, with its own count, then an honest grouped line", () => {
    const lines = notChargedSplit({
      callsNotCharged: 312,
      callsFailedCheck: 241,
      notChargedByReason: [
        { reason: "PROVIDER_ERROR", calls: 30 },
        { reason: "NO_USABLE_RESULT", calls: 20 },
        { reason: "NOT_COLLECTED", calls: 10 },
      ],
      callsNotChargedOther: 11,
    });
    expect(lines.map((l) => [l.label, l.calls])).toEqual([
      ["Result failed our check", 241],
      ["Provider returned an error", 30],
      ["No usable result", 20],
      ["Payment not collected", 10],
      ["The rest, incl. rounding remainders, grouped for privacy", 11],
    ]);
    expect(lines[0]!.tone).toBe("teal");
    expect(new Set(lines.map((l) => l.tone)).size).toBe(lines.length);
  });

  it("gives every reason its own hue, none of them the guarantee's teal or a green next to it", () => {
    const tones = Object.values(notChargedReasonTones());
    expect(new Set(tones).size).toBe(tones.length);
    expect(tones.filter((tone) => tone === "teal")).toHaveLength(1);
    expect(tones).not.toContain("success");
  });

  it("gives a reason the same tone whatever its place in the list", () => {
    const toneOf = (reasons: string[]) =>
      notChargedSplit({
        callsNotCharged: 100,
        callsFailedCheck: 0,
        notChargedByReason: reasons.map((reason) => ({ reason, calls: 10 })),
        callsNotChargedOther: 100 - reasons.length * 10,
      }).find((l) => l.key === "EXPIRED")!.tone;
    expect(toneOf(["EXPIRED"])).toBe(toneOf(["PROVIDER_ERROR", "OUT_OF_SCOPE", "EXPIRED"]));
  });

  it("leaves out the grouped line when nothing is in it", () => {
    const lines = notChargedSplit({
      callsNotCharged: 20,
      callsFailedCheck: 5,
      notChargedByReason: [{ reason: "PROVIDER_ERROR", calls: 15 }],
      callsNotChargedOther: 0,
    });
    expect(lines.map((l) => l.key)).toEqual(["FAILED_CHECK", "PROVIDER_ERROR"]);
  });

  it("names an unknown reason neutrally instead of dropping it", () => {
    const lines = notChargedSplit({
      callsNotCharged: 7,
      callsFailedCheck: 0,
      notChargedByReason: [{ reason: "SOMETHING_NEW", calls: 7 }],
      callsNotChargedOther: 0,
    });
    expect(lines[1]).toMatchObject({ label: "Another reason", calls: 7 });
  });

  it("shows one merged line, worded as a group, when the server sends no split or named nothing", () => {
    for (const totals of [
      { callsNotCharged: 312, callsFailedCheck: 241 },
      { callsNotCharged: 312, callsFailedCheck: 241, notChargedByReason: [], callsNotChargedOther: 71 },
    ]) {
      const lines = notChargedSplit(totals);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ key: "OTHER", calls: 71 });
      expect(lines[1]!.label).toMatch(/^Not charged for another reason/);
      expect(lines[1]!.label).toMatch(/rejected or out-of-scope request, expired/);
    }
  });

  it("is only the failed-check line when nothing else went uncharged", () => {
    expect(notChargedSplit({ callsNotCharged: 4, callsFailedCheck: 4, notChargedByReason: [], callsNotChargedOther: 0 })).toHaveLength(1);
  });
});

describe("notChargedPrivacyNote", () => {
  it("starts each sentence with a capital letter", () => {
    const withheld = notChargedPrivacyNote(true, 5);
    expect(withheld.startsWith("Some activity is hidden or grouped for privacy. A tool's calls are listed only once at least 5")).toBe(true);
    expect(notChargedPrivacyNote(false, 5).startsWith("For privacy, a tool's calls are listed")).toBe(true);
    for (const note of [withheld, notChargedPrivacyNote(false, 5)]) {
      expect(note).not.toMatch(/\. [a-z]/);
    }
  });
});
