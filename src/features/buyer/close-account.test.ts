import { describe, expect, it } from "vitest";

import type { FullBalance } from "@/features/g30/balance";

import { nothingToWithdraw, withdrawableByAsset } from "./close-account";

const row = (asset: string, amount: string, accountId: string, readable = true): FullBalance => ({
  chainId: asset.split("/")[0]!,
  accountId,
  asset,
  decimals: 6,
  available: { amount, asset, decimals: 6 },
  held: { amount: "0", asset, decimals: 6 },
  withdrawable: readable ? { amount, asset, decimals: 6 } : null,
  chainReadable: readable,
});

describe("withdrawableByAsset", () => {
  it("merges accounts of one asset into one total", () => {
    const asset = "eip155:46630/erc20:0x1";
    const lines = withdrawableByAsset([row(asset, "1000000", "a"), row(asset, "2500000", "b"), row(asset, "0", "c")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount.amount).toBe("3500000");
    expect(lines[0]!.accounts).toBe(3);
  });

  it("never adds two assets together", () => {
    const lines = withdrawableByAsset([row("eip155:1/erc20:0x1", "1", "a"), row("solana:x/token:y", "2", "b")]);
    expect(lines.map((l) => l.amount.amount)).toEqual(["1", "2"]);
  });

  it("does not call an unreadable chain empty", () => {
    const lines = withdrawableByAsset([row("eip155:1/erc20:0x1", "0", "a", false)]);
    expect(lines[0]!.complete).toBe(false);
    expect(nothingToWithdraw(lines)).toBe(false);
    expect(nothingToWithdraw(withdrawableByAsset([row("eip155:1/erc20:0x1", "0", "a")]))).toBe(true);
  });
});
