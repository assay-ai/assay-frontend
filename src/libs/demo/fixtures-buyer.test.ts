import { afterEach, describe, expect, it, vi } from "vitest";

import { isReplaceable } from "@/features/buyer-debt/debt-copy";

import { demoResponse } from "./demo-api";
import { DEMO_FIXTURES } from "./fixtures";
import { demoDebt, demoDebts } from "./fixtures-buyer";
import { demoOfferPriceMinor } from "./fixtures-explore";

describe("the demo buyer debt", () => {
  it("can be signed now: its replaceableAt is in the past", () => {
    const debt = demoDebt();
    expect(debt.replaceableAt).toBeTruthy();
    expect(Date.parse(debt.replaceableAt)).toBeLessThan(Date.now());
    expect(isReplaceable(debt, Date.now())).toBe(true);
    expect(DEMO_FIXTURES.some((fixture) => fixture.match === "/escrow/debts")).toBe(true);
  });
});

describe("the demo buyer's prices", () => {
  it("are the catalogue's prices for the same tool at the same provider", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const { items } = demoResponse("GET", "/tool-calls", {
        from: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }) as { items: { toolId: string; providerId: string; price: { amount: string } }[] };
      expect(new Set(items.map((item) => item.toolId)).size).toBe(5);
      for (const item of items) {
        expect(item.price.amount, item.toolId).toBe(demoOfferPriceMinor(item.toolId, item.providerId));
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it("price every demo debt, in every ?debt= picture, as the catalogue prices its tool", () => {
    for (const picture of ["open", "many", "other-wallet", "short", "waiting-mixed"]) {
      const store = new Map<string, string>();
      vi.stubGlobal("window", {
        location: { search: `?debt=${picture}` },
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        },
      });
      const debts = demoDebts();
      expect(debts.length, picture).toBeGreaterThan(0);
      for (const debt of debts) {
        expect(debt.amount.amount, `${picture} ${debt.toolId}`).toBe(demoOfferPriceMinor(debt.toolId, debt.providerId));
      }
    }
  });
});

describe("the demo /withheld split", () => {
  it("puts the voided search_web call under provider or platform error", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const body = demoResponse("GET", "/withheld", {}) as {
        withheld: { withheld: { amount: { amount: string }; buckets: { bucket: string; calls: number; amount: { amount: string } }[] } }[];
      };
      const { amount, buckets } = body.withheld[0]!.withheld;
      expect(amount.amount).toBe("1213200");
      expect(buckets.map((b) => [b.bucket, b.calls, b.amount.amount])).toEqual([
        ["FAILED_VERIFICATION", 2, "1201200"],
        ["PROVIDER_OR_PLATFORM_ERROR", 1, "12000"],
      ]);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });
});
