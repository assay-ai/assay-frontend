import { describe, expect, it } from "vitest";

import { providerSettlementRows } from "./provider-settlement";

const NOW = Date.parse("2026-10-31T12:30:00.000Z");

describe("operator payout runs (round-2 API-W2 §3.7)", () => {
  it("says the cadence, the next run and the last confirmed settle and collect", () => {
    const rows = providerSettlementRows(
      {
        providerId: "p1",
        payoutCadence: "EVERY_6_HOURS",
        nextPayoutAt: "2026-10-31T18:00:00.000Z",
        lastSettleAt: "2026-10-31T12:20:00.000Z",
        lastCollectAt: null,
        openChannels: 2,
        pendingSettlement: { amount: "1500000", asset: "eip155:46630/erc20:0x1", decimals: 6 },
      },
      NOW,
    );
    expect(rows).toEqual([
      { label: "Payout cadence", value: "Every 6 hours (default)" },
      { label: "Next payout", value: "about 18:00 UTC" },
      { label: "Last settle", value: "10 min ago" },
      { label: "Last collect", value: "None yet" },
      { label: "Pending settlement", value: "$1.50 · 2 open channels" },
    ]);
  });
});
