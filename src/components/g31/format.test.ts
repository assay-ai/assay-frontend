import { describe, expect, it } from "vitest";

import { chainLabel } from "@/utils/chain";

import { stakeLines, type ChainStake } from "./format";

/**
 * Bonded stake is per chain, and the rules it must obey on screen.
 *
 * The regression these pin: `stake` changed from a nullable `Money` to an
 * array, the `stake ? … : "—"` test in `providers-view.tsx` survived the
 * change, and every array is truthy — so the absent branch became unreachable
 * and the live branch handed an array to `formatMoney`, which threw inside
 * decimal.js on `Decimal.pow(undefined)`. Nothing typed caught it and nothing
 * on the screen degraded: the providers explorer went down.
 */

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const USDC_SOLANA = `${SOLANA}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;
const CHAIN_4663 = "eip155:4663";
const USDC_4663 = `${CHAIN_4663}/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`;

describe("stakeLines", () => {
  it("draws nothing for an empty list, so the caller can say 'not known'", () => {
    // Empty is "we could not read it" — an RPC outage, an unproved stake
    // authority — and never "staked nothing". The caller renders the dash off
    // this emptiness, which is the only signal that carries the meaning.
    expect(stakeLines([])).toEqual([]);
  });

  it("does not throw on an empty list", () => {
    // The measured failure was a throw, not a wrong string.
    expect(() => stakeLines([])).not.toThrow();
  });

  it("draws one chain as a bare figure, exactly as one chain always read", () => {
    const stake: ChainStake[] = [
      { chainId: SOLANA, amount: "90000000", asset: USDC_SOLANA, decimals: 6 },
    ];

    expect(stakeLines(stake)).toEqual([
      { chainId: SOLANA, label: null, amount: "$90.00" },
    ]);
  });

  it("names the chain on every line once there are two, and never sums them", () => {
    const stake: ChainStake[] = [
      { chainId: SOLANA, amount: "90000000", asset: USDC_SOLANA, decimals: 6 },
      { chainId: CHAIN_4663, amount: "40000000", asset: USDC_4663, decimals: 6 },
    ];

    const lines = stakeLines(stake);

    expect(lines).toEqual([
      { chainId: SOLANA, label: "solana:EtWT…", amount: "$90.00" },
      { chainId: CHAIN_4663, label: "eip155:4663", amount: "$40.00" },
    ]);

    // The sum, the "first one only" and the "lowest" are all wrong, and each
    // is wrong in its own way: $130 clears a floor neither chain clears,
    // showing $90 alone hides collateral, and a minimum across two different
    // CAIP-19 assets is an FX rate silently assumed to be 1.
    const rendered = lines.map((line) => line.amount);
    expect(rendered).toHaveLength(2);
    expect(rendered).not.toContain("$130.00");
  });

  it("keeps a chain read as zero, which is not the same as one that could not be read", () => {
    const stake: ChainStake[] = [
      { chainId: SOLANA, amount: "0", asset: USDC_SOLANA, decimals: 6 },
    ];

    expect(stakeLines(stake)).toEqual([{ chainId: SOLANA, label: null, amount: "$0.00" }]);
  });

  it("keeps decimals per entry rather than assuming one scale for the list", () => {
    const stake: ChainStake[] = [
      { chainId: SOLANA, amount: "90000000", asset: USDC_SOLANA, decimals: 6 },
      { chainId: CHAIN_4663, amount: "40000000000000000000", asset: USDC_4663, decimals: 18 },
    ];

    expect(stakeLines(stake).map((line) => line.amount)).toEqual(["$90.00", "$40.00"]);
  });
});

describe("chainLabel", () => {
  it("keeps a short reference whole, because for eip155 the number IS the chain", () => {
    expect(chainLabel("eip155:4663")).toBe("eip155:4663");
    expect(chainLabel("eip155:1")).toBe("eip155:1");
  });

  it("truncates a long reference but keeps enough to tell two networks apart", () => {
    expect(chainLabel(SOLANA)).toBe("solana:EtWT…");
    expect(chainLabel("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana:5eyk…");
    expect(chainLabel(SOLANA)).not.toBe(chainLabel("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"));
  });

  it("returns anything that is not a CAIP-2 id untouched rather than guessing", () => {
    expect(chainLabel("solana")).toBe("solana");
    expect(chainLabel("")).toBe("");
  });
});
