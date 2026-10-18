import { describe, expect, it } from "vitest";

import { foldDrafts, liveFirst, priceLine } from "./listing-copy";

const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });

describe("one price format", () => {
  it("reads Free, $x a call, or free calls then $x a call", () => {
    expect(priceLine({ pricingMode: "FREE", price: usd("0") })).toBe("Free");
    expect(priceLine({ pricingMode: "PAID", price: usd("100000") })).toBe("$0.10 a call");
    expect(priceLine({ pricingMode: "FREEMIUM", price: usd("2500") })).toBe("Free calls, then $0.0025 a call");
  });
});

describe("listing order", () => {
  const rows = [
    { id: "d1", status: "DRAFT" as const },
    { id: "p1", status: "PAUSED" as const },
    { id: "a1", status: "ACTIVE" as const },
    { id: "d2", status: "DRAFT" as const },
    { id: "a2", status: "ACTIVE" as const },
  ];

  it("puts live first, then paused, then drafts, keeping the API's order within each", () => {
    expect(liveFirst(rows).map((row) => row.id)).toEqual(["a1", "a2", "p1", "d1", "d2"]);
  });

  it("folds drafts out of Home's list", () => {
    const { shown, drafts } = foldDrafts(rows);
    expect(shown.map((row) => row.id)).toEqual(["a1", "a2", "p1"]);
    expect(drafts.map((row) => row.id)).toEqual(["d1", "d2"]);
  });
});
