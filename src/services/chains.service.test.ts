import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { chainDisplayName, findChain, settlementSymbol } from "./chains.service";

const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset:
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  settlementAssetSymbol: "USDC",
  decimals: 6,
};

const EVM: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://testnet-explorer.example/",
  settlementAsset: "eip155:46630/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

describe("findChain", () => {
  it("finds each of two chains, and does not answer for a third", () => {
    // Assert the loser: a function returning `chains[0]` passes the first line
    // on its own and is wrong for every two-chain user.
    expect(findChain([SOLANA, EVM], EVM.chainId)).toBe(EVM);
    expect(findChain([SOLANA, EVM], SOLANA.chainId)).toBe(SOLANA);
    expect(findChain([SOLANA, EVM], "eip155:1")).toBeNull();
    expect(findChain([], SOLANA.chainId)).toBeNull();
  });
});

describe("chainDisplayName", () => {
  it("uses the name the API served", () => {
    expect(chainDisplayName([SOLANA, EVM], EVM.chainId)).toBe("Robinhood Chain testnet");
  });

  it("falls back to the CAIP-2 label — never to a namespace, never to a guess", () => {
    // "Solana" for an unknown solana:* id collapses mainnet and devnet into
    // one word, on a screen where the difference is whether the money is real.
    expect(chainDisplayName([], "eip155:1")).toBe("eip155:1");
    expect(chainDisplayName([], SOLANA.chainId)).toBe("solana:EtWT…");
  });
});

/**
 * The symbol, and the reason it is served rather than derived.
 *
 * `settlementAsset` is `eip155:46630/erc20:0x915Ef7c9…` — no ticker in it —
 * and the only client-side way to turn a chain id into `USDG` is a table of
 * chain ids, which is a build-time copy one column narrower. So the
 * backend serves `settlementAssetSymbol` off `asset-registry.ts` and this
 * function is a lookup.
 */
describe("settlementSymbol", () => {
  it("answers per chain — the fixture's two chains settle in different tokens", () => {
    /*
      Both, together. `chains[0].settlementAssetSymbol` — the cheapest wrong
      implementation, and the one that reproduces the literal `"USDC"` that
      shipped — passes the first line and fails the second.
    */
    expect(settlementSymbol([SOLANA, EVM], SOLANA.chainId)).toBe("USDC");
    expect(settlementSymbol([SOLANA, EVM], EVM.chainId)).toBe("USDG");
  });

  it("answers null for a chain this deployment does not serve", () => {
    // Never a default: a symbol is a claim about which token a buyer is about
    // to send, and "we do not know yet" is a state every caller renders.
    expect(settlementSymbol([SOLANA, EVM], "eip155:1")).toBeNull();
    expect(settlementSymbol([], SOLANA.chainId)).toBeNull();
  });
});
