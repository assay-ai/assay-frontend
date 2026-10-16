import { describe, expect, it } from "vitest";

import type { ProviderReconciliation } from "@/interfaces";

import { fromLedger, takeCopy } from "./reconciliation";

const ASSET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

// The R17 demo answer (BUG-R17-R-03): gross 7.80, take 1.56, net 6.24, terms 10%.
function ledger(overrides: Partial<ProviderReconciliation> = {}): ProviderReconciliation {
  const row = (cls: string, calls: number, credited: string) => ({
    class: cls,
    calls,
    share: calls / 100,
    credited: usd(credited),
    note: "",
  });
  return {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-17T00:00:00.000Z",
    asset: ASSET,
    callCount: 100,
    classBreakdown: [
      row("PAID_CREDITED", 40, "5040000"),
      row("PAID_AWAITING_REDEMPTION", 0, "0"),
      row("PAID_BUYER_DEBT", 0, "0"),
      row("PAID_UNCOLLECTED", 0, "0"),
      row("PROVIDER_FORFEITED", 0, "0"),
      row("EXPLORATION", 10, "1200000"),
      row("TEST", 0, "0"),
      row("EXCLUDED", 0, "0"),
      row("PENDING", 50, "0"),
    ],
    unexplained: { calls: 0, reference: null },
    gross: usd("7800000"),
    platformTakeRatePercent: 10,
    platformTake: usd("1560000"),
    net: usd("6240000"),
    batches: { count: 0, paid: usd("0"), reconciles: false },
    ...overrides,
  };
}

describe("fromLedger", () => {
  it("takes the month's counts from the endpoint, not the capped file", () => {
    const summary = fromLedger(ledger({ callCount: 204_820 }));
    expect(summary.source).toBe("ledger");
    expect(summary.totalCalls).toBe(204_820);
  });

  it("keeps the debt, uncollected and forfeited classes at zero, drops other empty ones", () => {
    const names = fromLedger(ledger()).rows.map((row) => row.className);
    expect(names).toEqual([
      "PAID_CREDITED",
      "PAID_BUYER_DEBT",
      "PAID_UNCOLLECTED",
      "PROVIDER_FORFEITED",
      "EXPLORATION",
      "PENDING",
    ]);
  });

  it("has a Credited column that sums to net, and gross − take = net", () => {
    const summary = fromLedger(ledger());
    const credited = summary.rows.reduce((sum, row) => sum + BigInt(row.credited?.amount ?? "0"), 0n);
    expect(credited.toString()).toBe(summary.net?.amount);
    expect(BigInt(summary.gross!.amount) - BigInt(summary.take!.amount)).toBe(BigInt(summary.net!.amount));
  });

  it("measures the realised rate from the figures", () => {
    const summary = fromLedger(ledger());
    expect(summary.observedRate).toBe("20%");
    expect(summary.configuredRatePercent).toBe(10);
  });
});

describe("takeCopy", () => {
  it("does not say verified when the fees taken differ from the terms", () => {
    const copy = takeCopy(fromLedger(ledger()));
    expect(copy.label).toBe("Platform take (observed 20%, terms 10%)");
    expect(copy.label).not.toMatch(/verified/);
    expect(copy.note).toMatch(/not verified/);
  });

  it("says verified when they agree", () => {
    const copy = takeCopy(fromLedger(ledger({ platformTake: usd("780000"), net: usd("7020000") })));
    expect(copy.label).toBe("Platform take (10%, verified)");
  });

  it("prints no rate nobody paid when no fee was taken", () => {
    const copy = takeCopy(fromLedger(ledger({ platformTake: usd("0") })));
    expect(copy.label).toBe("Platform take (10% in your terms)");
    expect(copy.note).toBe("no fee was taken on these calls");
  });
});
