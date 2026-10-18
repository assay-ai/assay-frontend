import { afterEach, describe, expect, it, vi } from "vitest";

import { isReplaceable } from "@/features/buyer-debt/debt-copy";

import { demoResponse } from "./demo-api";
import { DEMO_FIXTURES } from "./fixtures";
import { demoDebt, demoDebts, resetDemoAgentLabels } from "./fixtures-buyer";
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
        ["NOT_COLLECTED", 0, "0"],
      ]);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  it("agrees with /receipts/summary's not charged for the same window", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const now = Date.now();
      for (const days of [1, 7, 30, 60]) {
        const window = {
          from: new Date(now - days * 86_400_000).toISOString(),
          to: new Date(now + 60_000).toISOString(),
        };
        const withheld = (
          demoResponse("GET", "/withheld", window) as {
            withheld: { withheld: { calls: number; amount: { amount: string } } }[];
          }
        ).withheld[0]!.withheld;
        const { totals } = demoResponse("GET", "/receipts/summary", { ...window, groupBy: "day" }) as {
          totals: { notChargedTotal: { amount: string }; notChargedCalls: number };
        };
        expect(withheld.amount.amount, `${days} days`).toBe(totals.notChargedTotal.amount);
        expect(withheld.calls, `${days} days`).toBe(totals.notChargedCalls);
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });
});

describe("the demo agent rename", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDemoAgentLabels();
  });

  it("answers PATCH /agents/:id with the renamed agent, and GET /agents reads it back", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood");
    const before = demoResponse("GET", "/agents") as { items: { agentId: string; label: string }[] };
    const first = before.items[0]!;

    const renamed = demoResponse("PATCH", `/agents/${first.agentId}`, {}, { label: "  Research bot  " }) as {
      agentId: string;
      label: string;
    };

    expect(renamed).toMatchObject({ agentId: first.agentId, label: "Research bot" });
    const after = demoResponse("GET", "/agents") as { items: { agentId: string; label: string }[] };
    expect(after.items.find((a) => a.agentId === first.agentId)?.label).toBe("Research bot");
  });

  it("refuses an agent that is not the account's, like the server", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood");
    expect(() => demoResponse("PATCH", "/agents/00000000-0000-4000-8000-000000000000", {}, { label: "x" })).toThrow(/not found/i);
  });
});
