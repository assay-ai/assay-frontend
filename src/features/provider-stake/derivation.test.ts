import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { isAssetMismatch, missingRequirementNote, readableDerivation, stakeReason, requiredText } from "./derivation";

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

// BUG-R16-V3-01: an ACTIVE binding with no requirement row was labelled "not active".
describe("missingRequirementNote", () => {
  it("never calls an ACTIVE binding not active", () => {
    expect(missingRequirementNote("ACTIVE")).not.toMatch(/not active/);
    expect(missingRequirementNote("ACTIVE")).toMatch(/^active/);
  });

  it("names the real state of a binding that is not live", () => {
    expect(missingRequirementNote("PAUSED")).toMatch(/^paused/);
    expect(missingRequirementNote("DRAFT")).toMatch(/^draft/);
  });
});

describe("isAssetMismatch", () => {
  it("tells the mismatch refusal from ordinary arithmetic", () => {
    expect(
      isAssetMismatch(`priced in ${USDC}, stake floor in ${USDG} — not routable (STAKE_ASSET_MISMATCH)`)
    ).toBe(true);
    expect(isAssetMismatch("max(floor $500.00, 1000 × $0.0100) = $500.00")).toBe(false);
  });
});

describe("requiredText (merge audit L3)", () => {
  it("never prints $0.00 for a zero or missing minimum", () => {
    expect(requiredText({ amount: "0", asset: "x", decimals: 6 })).toBe("—");
    expect(requiredText(null)).toBe("—");
    expect(requiredText({ amount: "50000000", asset: "x", decimals: 6 })).toBe("$50.00");
  });
});
