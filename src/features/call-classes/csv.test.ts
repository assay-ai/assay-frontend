import { describe, expect, it } from "vitest";

import {
  assetScopeNote,
  type CallRow,
  callsOnDay,
  foldClasses,
  foldNotCredited,
  observedTakeRate,
  pendingNote,
  PENDING_PAYMENT_NOTE,
  rowsInAsset,
} from "./csv";

const ASSET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function row(overrides: Partial<CallRow>): CallRow {
  return {
    callId: "call",
    intentId: "intent",
    createdAt: "2026-10-11T00:00:00.000Z",
    toolId: "tool",
    status: "SETTLED",
    classification: "PAID_CREDITED",
    reason: "",
    verdict: "PASS",
    providerAmount: "900000",
    platformFee: "100000",
    priceAmount: "1000000",
    asset: ASSET,
    decimals: 6,
    ...overrides,
  };
}

describe("foldClasses — rail B awaiting redemption", () => {
  it("counts a settled, unredeemed call in its own bucket and credits nothing for it", () => {
    const table = foldClasses([
      row({ callId: "a" }),
      row({ callId: "b", classification: "PAID_AWAITING_REDEMPTION" }),
    ]);

    const awaiting = table.buckets.find((b) => b.className === "PAID_AWAITING_REDEMPTION");
    expect(awaiting?.calls).toBe(1);
    expect(awaiting?.credited?.amount ?? "0").toBe("0");
    expect(awaiting?.withheld?.amount ?? "0").toBe("0");
    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.unexplained).toBe(0);
  });
});

// No platform debt: a call whose payment could not be collected is the
// BUYER's debt. Open, it is not earned and not withheld; written off, it is
// closed with nothing paid. The platform never credits it.
describe("PAID_BUYER_DEBT", () => {
  const rows = [
    row({ callId: "a" }),
    row({ callId: "b", classification: "PAID_BUYER_DEBT", reason: "buyer_debt:DelegateIsRevoked" }),
  ];

  it("gets its own bucket and is neither earned nor withheld", () => {
    const table = foldClasses(rows);
    const debt = table.buckets.find((b) => b.className === "PAID_BUYER_DEBT");
    expect(debt?.calls).toBe(1);
    expect(debt?.credited?.amount ?? "0").toBe("0");
    expect(debt?.withheld?.amount ?? "0").toBe("0");
    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.totalWithheld?.amount ?? "0").toBe("0");
    expect(table.unexplained).toBe(0);
    expect(foldNotCredited(rows).calls).toBe(0);
  });

  it("does not read as a 0% take rate", () => {
    expect(observedTakeRate(rows).summary).toBe("observed 10%");
  });
});

describe("PAID_UNCOLLECTED", () => {
  const rows = [
    row({ callId: "a" }),
    row({
      callId: "b",
      classification: "PAID_UNCOLLECTED",
      reason: "uncollected:DelegateIsRevoked",
      providerAmount: "0",
      platformFee: "0",
    }),
  ];

  it("gets its own bucket and is not earned", () => {
    const table = foldClasses(rows);
    const uncollected = table.buckets.find((b) => b.className === "PAID_UNCOLLECTED");
    expect(uncollected?.calls).toBe(1);
    expect(uncollected?.credited?.amount ?? "0").toBe("0");
    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.totalGross?.amount).toBe("1000000");
    expect(table.unexplained).toBe(0);
  });

  it("does not read as a 0% take rate", () => {
    expect(observedTakeRate(rows).summary).toBe("observed 10%");
  });
});

// A buyer debt voided by a late FAIL / REFUND / VOID verdict: still SETTLED,
// but PAID_UNCREDITED with zero amounts — not earned, nothing withheld, and
// its listed price is not gross revenue.
describe("a voided buyer debt", () => {
  const rows = [
    row({ callId: "a" }),
    row({
      callId: "b",
      classification: "PAID_UNCREDITED",
      reason: "voided:FAIL",
      providerAmount: "0",
      platformFee: "0",
    }),
  ];

  it("is neither earned nor gross, and withholds nothing", () => {
    const table = foldClasses(rows);
    const uncredited = table.buckets.find((b) => b.className === "PAID_UNCREDITED");
    expect(uncredited?.calls).toBe(1);
    expect(uncredited?.credited?.amount ?? "0").toBe("0");
    expect(uncredited?.withheld?.amount ?? "0").toBe("0");
    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.totalGross?.amount).toBe("1000000");
    expect(table.totalWithheld?.amount ?? "0").toBe("0");
  });

  it("does not read as a 0% take rate", () => {
    expect(observedTakeRate(rows).summary).toBe("observed 10%");
  });
});

// Review 2026-10-15, M2: a voucher the provider forfeited (stake below the
// minimum, or a block) is SETTLED but nobody was charged, credited or paid a fee.
describe("PROVIDER_FORFEITED", () => {
  const rows = [
    row({ callId: "a" }),
    row({
      callId: "b",
      classification: "PROVIDER_FORFEITED",
      reason: "provider_forfeit:ProviderBelowMinimumStake",
      providerAmount: "0",
      platformFee: "0",
    }),
  ];

  it("gets its own bucket and is not counted as earned", () => {
    const table = foldClasses(rows);
    const forfeited = table.buckets.find((b) => b.className === "PROVIDER_FORFEITED");
    expect(forfeited?.calls).toBe(1);
    expect(forfeited?.credited?.amount ?? "0").toBe("0");
    expect(forfeited?.gross?.amount ?? "0").toBe("0");
    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.totalGross?.amount).toBe("1000000");
    expect(table.unexplained).toBe(0);
  });

  it("is listed among the calls that were not credited", () => {
    const failed = foldNotCredited(rows);
    expect(failed.calls).toBe(1);
    expect(failed.buckets[0]?.className).toBe("PROVIDER_FORFEITED");
  });

  it("does not read as a 0% take rate", () => {
    expect(observedTakeRate(rows).summary).toBe("observed 10%");
  });
});

describe("foldClasses — settled with no credit recorded (BUG-R2-V3-03)", () => {
  it("credits nothing for a settled row the export marks PENDING", () => {
    const table = foldClasses([
      row({ callId: "a" }),
      row({ callId: "b", classification: "PENDING", platformFee: "0" }),
    ]);

    expect(table.totalCredited?.amount).toBe("900000");
    expect(table.totalWithheld?.amount).toBe("0");
  });
});

describe("rowsInAsset — one money figure, one asset", () => {
  const OTHER = "eip155:46630/erc20:0xDbbC";
  const rows = [row({ callId: "a" }), row({ callId: "b", asset: OTHER, providerAmount: "180000" })];

  it("keeps only the rows in the display asset", () => {
    const table = foldClasses(rowsInAsset(rows, OTHER));
    expect(table.totalCalls).toBe(1);
    expect(table.totalCredited).toMatchObject({ amount: "180000", asset: OTHER });
  });

  it("keeps every row when no asset is selected (a one-asset provider)", () => {
    expect(rowsInAsset(rows, undefined)).toHaveLength(2);
  });

  // /provider/view (R3 retest item 5): the failed-calls table summed both assets.
  it("scopes the failed-calls money and the day count the provider view shows", () => {
    const failed = [
      row({ callId: "c", classification: "SYSTEM_ERROR", status: "VOIDED", providerAmount: "90000" }),
      row({
        callId: "d",
        classification: "SYSTEM_ERROR",
        status: "VOIDED",
        asset: OTHER,
        providerAmount: "45000",
      }),
    ];
    const scoped = rowsInAsset(failed, OTHER);
    expect(foldNotCredited(scoped)).toMatchObject({
      calls: 1,
      notCredited: { amount: "45000", asset: OTHER },
    });
    expect(callsOnDay(scoped, "2026-10-11")).toBe(1);
  });
});

describe("pendingNote — true to why the rows are pending", () => {
  const settled = row({ classification: "PENDING", reason: "settled, no credit recorded" });
  const inFlight = row({ classification: "PENDING", status: "VERIFYING" });

  it("does not call a settled, uncredited call in flight", () => {
    expect(pendingNote([settled, row({})])).toBe(PENDING_PAYMENT_NOTE);
    expect(PENDING_PAYMENT_NOTE).toMatch(/still being checked/);
  });

  it("says in flight only when the calls are", () => {
    expect(pendingNote([inFlight])).toBe("the response is still being checked · no money has moved");
  });

  it("splits a mixed bucket by count", () => {
    expect(pendingNote([settled, settled, inFlight])).toBe(
      "2 with the payment still being checked (no credit recorded yet) · 1 with the response still being checked · not paid to you yet"
    );
  });
});

// BUG-R16-V3-03: the class table said 4 calls beside a 50,000-row file, because
// it counts one asset and the file holds every asset.
describe("assetScopeNote", () => {
  it("says nothing when the table covers the whole file", () => {
    expect(assetScopeNote(4, 4, "USDG on Robinhood Chain testnet")).toBeNull();
  });

  it("says the table is one asset's share of the file", () => {
    const note = assetScopeNote(50_000, 4, "USDG on Robinhood Chain testnet");
    expect(note).toContain("4 calls in USDG on Robinhood Chain testnet");
    expect(note).toContain("50,000 calls in every asset");
    expect(note).toContain("other 49,996 are in another asset");
  });
});
