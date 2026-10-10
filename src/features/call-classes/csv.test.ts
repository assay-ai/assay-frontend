import { describe, expect, it } from "vitest";

import { type CallRow, foldClasses } from "./csv";

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
