import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { policyBootstrapAsset } from "./policy-bootstrap";

const EVM = "eip155:46630";
const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const CHAINS: Chain[] = [
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset: `${EVM}/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
  {
    chainId: SOLANA,
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: `${SOLANA}/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`,
    settlementAssetSymbol: "USDC",
    decimals: 6,
  },
];

describe("policyBootstrapAsset — the asset a first spend policy is written in", () => {
  it("takes the settlement asset of the agent's own chain, never the first chain", () => {
    // Solana is listed second here on purpose, and the EVM buyer must get USDG.
    expect(policyBootstrapAsset([{ agentId: "a", chainId: EVM }], CHAINS)).toEqual({
      kind: "ready",
      assetId: `${EVM}/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3`,
      decimals: 6,
      symbol: "USDG",
      chainName: "Robinhood Chain testnet",
    });
    expect(policyBootstrapAsset([{ agentId: "a", chainId: SOLANA }], CHAINS)).toMatchObject({
      kind: "ready",
      symbol: "USDC",
    });
  });

  it("reads the chain off the CAIP-10 agentAccount when chainId is absent", () => {
    expect(
      policyBootstrapAsset([{ agentId: "a", agentAccount: `${EVM}:0x18103e1D79257c695B2FBbd4b346CD2Ba7927296` }], CHAINS),
    ).toMatchObject({ kind: "ready", symbol: "USDG" });
  });

  it("is still reading while either list is missing", () => {
    expect(policyBootstrapAsset(undefined, CHAINS)).toEqual({ kind: "reading" });
    expect(policyBootstrapAsset([{ agentId: "a", chainId: EVM }], [])).toEqual({ kind: "reading" });
  });

  it("refuses to guess when agents sit on two chains, or on none this deployment offers", () => {
    expect(
      policyBootstrapAsset(
        [
          { agentId: "a", chainId: EVM },
          { agentId: "b", chainId: SOLANA },
        ],
        CHAINS,
      ).kind,
    ).toBe("unknown");
    expect(policyBootstrapAsset([{ agentId: "a", chainId: "eip155:1" }], CHAINS).kind).toBe("unknown");
    expect(policyBootstrapAsset([], CHAINS).kind).toBe("unknown");
  });
});
