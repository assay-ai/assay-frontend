import { describe, expect, it } from "vitest";

import {
  assetScopeNote,
  type CallRow,
  callsOnDay,
  foldClasses,
  foldNotCredited,
  observedTakeRate,
  pendingNote,
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

describe("PLATFORM_ABSORBED", () => {
  const rows = [
    row({ callId: "a" }),
    row({
      callId: "b",
      classification: "PLATFORM_ABSORBED",
      reason: "DelegateIsRevoked",
      platformFee: "0",
    }),
  ];

  it("gets its own bucket: credited, no fee, not unexplained", () => {
    const table = foldClasses(rows);
    const absorbed = table.buckets.find((b) => b.className === "PLATFORM_ABSORBED");
    expect(absorbed?.calls).toBe(1);
    expect(absorbed?.credited?.amount).toBe("900000");
    expect(absorbed?.fee?.amount).toBe("0");
    expect(table.totalCredited?.amount).toBe("1800000");
    expect(table.totalFee?.amount).toBe("100000");
    expect(table.unexplained).toBe(0);
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
    expect(pendingNote([settled, row({})])).toBe("settled, no credit recorded · not paid to you");
  });

  it("says in flight only when the calls are", () => {
    expect(pendingNote([inFlight])).toBe("still in flight — no money has moved");
  });

  it("splits a mixed bucket by count", () => {
    expect(pendingNote([settled, settled, inFlight])).toBe(
      "2 settled, no credit recorded · 1 still in flight"
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
