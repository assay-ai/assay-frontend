import { describe, expect, it } from "vitest";

import type { ProviderPayout } from "@/interfaces";

import { payoutsInAsset } from "./provider-payouts.service";

const USDC = "solana:EtWT/token:4zMM";
const USDG = "eip155:46630/erc20:0xDbbC";

function payout(id: string, asset: string, amount: string): ProviderPayout {
  return {
    id,
    kind: "REDEMPTION",
    amount: { amount, asset, decimals: 6 },
    chainTxRef: null,
    calls: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

const rows = [payout("a", USDC, "2500000"), payout("b", USDC, "3000000"), payout("c", USDG, "1")];

describe("payoutsInAsset", () => {
  it("keeps only the payouts paid in the display asset", () => {
    expect(payoutsInAsset(rows, USDG).map((p) => p.id)).toEqual(["c"]);
    expect(payoutsInAsset(rows, USDC).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps every payout for a one-asset provider", () => {
    expect(payoutsInAsset(rows, undefined)).toHaveLength(3);
  });
});
