import { describe, expect, it } from "vitest";

import { foldNotCredited, parseCallsCsv } from "@/features/call-classes/csv";
import { classLabel } from "@/features/call-classes/labels";
import { classNote } from "@/features/call-classes/reconciliation";
import { demoCallsCsv } from "@/libs/demo/fixtures-provider-calls";

import { callCount, notCreditedReason, notCreditedRows, partsThatAddUp, unpaidCallAmount } from "./not-credited";

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

describe("notCreditedRows", () => {
  const rows = parseCallsCsv(demoCallsCsv());

  it("keeps written-off and forfeited calls out, so the reasons add up to withheld", () => {
    const { rows: kept, passedUnpaid } = notCreditedRows(rows);
    const folded = foldNotCredited(kept);
    // The demo earnings say withheld = $1.62 over 4 calls (`withheldCalls`).
    expect(folded.calls).toBe(4);
    expect(folded.notCredited?.amount).toBe("1620000");
    expect(folded.buckets.map((b) => b.className)).not.toContain("PAID_UNCOLLECTED");
    expect(folded.buckets.map((b) => b.className)).not.toContain("PROVIDER_FORFEITED");
    // One never collected, one forfeited (the demo seed, kept apart from the $0.81 of failed checks).
    expect(passedUnpaid).toBe(2);
  });

  it("lists the forfeited and written-off calls when nothing removes them", () => {
    const all = foldNotCredited(rows);
    expect(all.calls).toBe(6);
  });

  it("has no reason card for the passed-but-unpaid classes any more", () => {
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
