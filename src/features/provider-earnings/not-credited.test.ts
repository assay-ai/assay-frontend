import { describe, expect, it } from "vitest";

import { classLabel } from "@/features/call-classes/labels";
import { classNote } from "@/features/call-classes/reconciliation";

import type { Money, NotCreditedClass, ProviderEarningsFigures, ProviderEarningsGroup } from "@/interfaces";

import {
  callCount,
  notCreditedBreakdown,
  notCreditedReason,
  partsThatAddUp,
  settlementShown,
  shownReasonAmounts,
  toolsLine,
  unpaidCallAmount,
} from "./not-credited";

describe("partsThatAddUp", () => {
  it("hands the lost cent to the largest remainder so the parts add up", () => {
    // $0.81 + $0.405 + $0.405 = $1.62
    expect(partsThatAddUp(["810000", "405000", "405000"], 6)).toEqual(["810000", "410000", "400000"]);
  });

  it("never exceeds the truncated total", () => {
    const parts = partsThatAddUp(["3333", "3333", "3333"], 6);
    expect(parts.reduce((s, p) => s + BigInt(p), 0n)).toBe(0n);
  });

  it("keeps exact cents untouched", () => {
    expect(partsThatAddUp(["1000000", "250000"], 6)).toEqual(["1000000", "250000"]);
  });

  it("returns an empty list for no parts", () => {
    expect(partsThatAddUp([], 6)).toEqual([]);
  });
});

describe("callCount", () => {
  it("pluralises", () => {
    expect(callCount(1)).toBe("1 call");
    expect(callCount(2)).toBe("2 calls");
    expect(callCount(1200)).toBe("1,200 calls");
  });
});

describe("notCreditedReason", () => {
  it("has no reason card for the passed-but-unpaid classes", () => {
    expect(notCreditedReason("PAID_UNCOLLECTED").title).toBe("Not credited");
    expect(notCreditedReason("PROVIDER_FORFEITED").title).toBe("Not credited");
  });
});

describe("notCreditedReason and the outcome list", () => {
  it("names each class the same way in the reasons and in the Explain drawer's outcome list", () => {
    for (const name of ["PAID_UNCREDITED", "SYSTEM_ERROR", "REQUEST_ERROR"]) {
      expect(notCreditedReason(name).title).toBe(classLabel(name));
    }
  });
  it("never blames the answer for a refused request", () => {
    expect(notCreditedReason("REQUEST_ERROR").title).toMatch(/4xx/);
    expect(classNote("REQUEST_ERROR")).toMatch(/4xx/);
    expect(`${classLabel("REQUEST_ERROR")} ${classNote("REQUEST_ERROR")}`).not.toMatch(/checks|answer/);
  });
});

describe("unpaidCallAmount", () => {
  const base = { asset: "a", decimals: 6, priceAmount: "450000" };
  it("shows the provider's share when the export carries one (buyer debt)", () => {
    expect(unpaidCallAmount({ ...base, providerAmount: "405000" })).toEqual({
      amount: { amount: "405000", asset: "a", decimals: 6 },
      note: null,
    });
  });
  it("works out the share at the fee rate when the export sends 0 (written off, forfeited)", () => {
    // Two $0.45 calls at a 10% fee are $0.405 each: the line's $0.81.
    expect(unpaidCallAmount({ ...base, providerAmount: "0" }, 10)).toEqual({
      amount: { amount: "405000", asset: "a", decimals: 6 },
      note: "of $0.45 listed, after Assay's 10% fee",
    });
    expect(unpaidCallAmount({ ...base, providerAmount: "0" }, 0).amount.amount).toBe("450000");
  });
  it("falls back to the listed price, said to be before the fee, when no single rate is known", () => {
    for (const rate of [undefined, null, Number.NaN, 100]) {
      expect(unpaidCallAmount({ ...base, providerAmount: "0" }, rate)).toEqual({
        amount: { amount: "450000", asset: "a", decimals: 6 },
        note: "listed price, before Assay's fee",
      });
    }
  });
});

const usd = (amount: string): Money => ({ amount, asset: "usdg", decimals: 6 });
const byClass = (failed: [number, string], endpoint: [number, string], refused: [number, string]) =>
  (
    [
      ["PAID_UNCREDITED", failed],
      ["SYSTEM_ERROR", endpoint],
      ["REQUEST_ERROR", refused],
    ] as [NotCreditedClass, [number, string]][]
  ).map(([cls, [calls, amount]]) => ({ class: cls, calls, amount: usd(amount) }));

function figures(withheldByClass: ReturnType<typeof byClass>, withheld = "0", withheldCalls = 0): ProviderEarningsFigures {
  return { calls: 108, earned: usd("6084000"), platformFee: usd("676000"), withheld: usd(withheld), withheldCalls, withheldByClass };
}

describe("notCreditedBreakdown", () => {
  // The seed of the UX review: 12 failed checks, 8 endpoint errors, 2 refused = 22 calls, $0.74.
  const totals = figures(byClass([12, "353000"], [8, "297000"], [2, "90000"]), "740000", 22);

  it("is one breakdown whose summary is the sum of its reasons", () => {
    const breakdown = notCreditedBreakdown(totals);
    expect(breakdown.calls).toBe(22);
    expect(breakdown.amount?.amount).toBe("740000");
    expect(breakdown.reasons.map((r) => [r.className, r.calls])).toEqual([
      ["PAID_UNCREDITED", 12],
      ["SYSTEM_ERROR", 8],
      ["REQUEST_ERROR", 2],
    ]);
    const sum = breakdown.reasons.reduce((s, r) => s + BigInt(r.amount?.amount ?? "0"), 0n);
    expect(sum.toString()).toBe(breakdown.amount?.amount);
  });

  it("follows the reasons, not a stale withheld, when the two disagree", () => {
    const breakdown = notCreditedBreakdown({ ...totals, withheld: usd("540000"), withheldCalls: 14 });
    expect(breakdown.calls).toBe(22);
    expect(breakdown.amount?.amount).toBe("740000");
  });

  it("shows reason amounts that add up to the shown summary", () => {
    const breakdown = notCreditedBreakdown(figures(byClass([2, "810000"], [1, "405000"], [1, "405000"])));
    const shown = shownReasonAmounts(breakdown.reasons).map((m) => m?.amount);
    expect(shown).toEqual(["810000", "410000", "400000"]);
  });

  it("drops reasons with no calls and names the tools each one happened on", () => {
    const groups: ProviderEarningsGroup[] = [
      { key: "tool-a", ...figures(byClass([1, "1"], [0, "0"], [0, "0"])) },
      { key: "tool-b", ...figures(byClass([1, "1"], [0, "0"], [0, "0"])) },
      { key: "tool-c", ...figures(byClass([0, "0"], [0, "0"], [0, "0"])) },
    ];
    const breakdown = notCreditedBreakdown(figures(byClass([2, "2"], [0, "0"], [0, "0"])), groups);
    expect(breakdown.reasons).toEqual([
      { className: "PAID_UNCREDITED", calls: 2, amount: usd("2"), toolIds: ["tool-a", "tool-b"] },
    ]);
  });

  it("falls back to withheld, with no reasons, for a backend that sends no breakdown", () => {
    const breakdown = notCreditedBreakdown({ calls: 3, earned: null, platformFee: null, withheld: usd("9"), withheldCalls: 3 });
    expect(breakdown).toEqual({ calls: 3, amount: usd("9"), reasons: [] });
    expect(notCreditedBreakdown(null)).toEqual({ calls: 0, amount: null, reasons: [] });
  });
});

describe("toolsLine", () => {
  const names: Record<string, string> = { a: "get_usd_eur_rate", b: "geocode_place" };
  const toolName = (id: string) => names[id] ?? null;

  it("names known tools and counts the rest once, never 'a tool' repeated", () => {
    const line = toolsLine(["a", "b", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"], toolName);
    expect(line).toBe("get_usd_eur_rate, geocode_place +8 removed tools");
    expect(line).not.toMatch(/a tool/);
  });

  it("counts unnamed tools alone, and says nothing for none", () => {
    expect(toolsLine(["x1"], toolName)).toBe("1 removed tool");
    expect(toolsLine(["a"], toolName)).toBe("get_usd_eur_rate");
    expect(toolsLine([], toolName)).toBeNull();
  });

  it("says nothing while the catalogue loads, rather than call every tool removed", () => {
    expect(toolsLine(["a", "x1"], () => null, true)).toBeNull();
  });

  it("never says removed when the catalogue failed to load (review I2)", () => {
    expect(toolsLine(["a", "x1"], toolName, false, false)).toBe("get_usd_eur_rate +1 other tool");
    expect(toolsLine(["x1", "x2"], () => null, false, false)).toBe("2 tools");
  });
});

describe("settlementShown", () => {
  it("rounds once, from cents, so Gross − fee = Net on screen", () => {
    // The review's month: $6.084 net, $0.676 fee, $6.76 gross.
    const shown = settlementShown(usd("6084000"), usd("676000"));
    expect(shown.net?.amount).toBe("6080000");
    expect(shown.fee?.amount).toBe("680000");
    expect(shown.gross?.amount).toBe("6760000");
  });

  it("is all null when there is nothing to show", () => {
    expect(settlementShown(null, null)).toEqual({ net: null, fee: null, gross: null });
  });
});
