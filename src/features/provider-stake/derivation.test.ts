import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { readableDerivation, stakeReason } from "./derivation";

const USDC = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDG = "eip155:46630/erc20:0xDbbC0000000000000000000000000000000000aa";
const chains = [
  { chainId: USDC.split("/")[0], displayName: "Solana devnet", settlementAsset: USDC, settlementAssetSymbol: "USDC" },
  { chainId: USDG.split("/")[0], displayName: "Robinhood Chain testnet", settlementAsset: USDG, settlementAssetSymbol: "USDG" },
] as unknown as Chain[];

// BUG-R4-D-05: the wire's line named raw asset ids and an internal reason code.
describe("readableDerivation", () => {
  it("says an asset mismatch in plain words, with asset and chain names", () => {
    const line = readableDerivation(
      `priced in ${USDC}, stake floor in ${USDG} — not routable (STAKE_ASSET_MISMATCH)`,
      chains
    );
    expect(line).toBe(
      "Priced in USDC on Solana devnet, but stake is counted in USDG on Robinhood Chain testnet. This binding receives no paid traffic until both use the same asset."
    );
    expect(line).not.toMatch(/STAKE_ASSET_MISMATCH|eip155|solana:/);
  });

  it("leaves the arithmetic of a matching binding as it is", () => {
    const line = "max(floor $500.00, 1000 × $0.0100) = $500.00";
    expect(readableDerivation(line, chains)).toBe(line);
  });
});

describe("stakeReason", () => {
  it("names the price when it drives the requirement", () => {
    expect(stakeReason("max(floor 50.000000, 1000 × 0.450000) = 450.000000", chains)).toBe("price $0.45 × 1,000 calls");
  });
  it("names the floor when it binds", () => {
    expect(stakeReason("max(floor 50.000000, 1000 × 0.010000) = 50.000000", chains)).toBe(
      "the $50.00 minimum for a paid tool",
    );
  });
  it("never prints a formula it cannot read", () => {
    expect(stakeReason("something else", chains)).toBe("the minimum for this tool");
  });
});
