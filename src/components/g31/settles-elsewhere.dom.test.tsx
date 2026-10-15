import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { SettlesElsewhere } from "./tools-view";
import type { ToolRow } from "./use-catalogue";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const CHAINS: Chain[] = [
  {
    chainId: SOLANA,
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: `${SOLANA}/token:4zMM`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://testnet-explorer.example/",
    settlementAsset: `${EVM}/erc20:0xa0b8`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

function tool(settlementChains: string[] | undefined): ToolRow {
  return {
    toolId: "b0a2f1c4-0000-4000-8000-000000000001",
    name: "search.web",
    description: "web search",
    tier: "VERIFIED",
    pricingMode: "PAID",
    providerCount: 2,
    fromPrice: null,
    price: null,
    routable: true,
    unroutableReason: null,
    settlementChains,
    yourCalls: 0,
    listed: null,
    charged: null,
  };
}

function markup(settlementChains: string[] | undefined, buyerChains: string[]): string {
  return renderToStaticMarkup(
    <SettlesElsewhere tool={tool(settlementChains)} buyerChains={buyerChains} chains={CHAINS} />,
  );
}

describe("SettlesElsewhere — marked, never hidden", () => {
  it("names the chain in words and links to funding when the buyer cannot reach it", () => {
    const html = markup([EVM], [SOLANA]);
    expect(html).toContain("Settles on Robinhood Chain testnet");
    expect(html).toContain("you have no funds there");
    expect(html).toContain('href="/funding/deposit"');
    /* The display name, never the raw CAIP-2 id. */
    expect(html).not.toContain(EVM);
  });

  it("names EVERY chain the tool settles on", () => {
    const html = markup(["eip155:84532", EVM], [SOLANA]);
    expect(html).toContain("Robinhood Chain testnet");
    /* No name for 84532 in the list, so the CAIP-2 label stands in — not a
       dropped chain, which would send the buyer to fund the wrong one. */
    expect(html).toContain("eip155:84532");
  });

  it("says nothing when the buyer already funds one of the tool's chains", () => {
    expect(markup([SOLANA, EVM], [SOLANA])).toBe("");
  });

  it("says nothing when the tool declares no chains — the state of EVERY row today", () => {
    /*
      `GET /catalogue/tools` has no `settlementChains`, so absence is the
      normal case. A caveat here would appear on every row in the catalogue and
      be false on all of them.
    */
    expect(markup(undefined, [SOLANA])).toBe("");
    expect(markup([], [SOLANA])).toBe("");
  });

  it("says nothing when the buyer's own chains are unknown", () => {
    // A failed /balances read is not a buyer who cannot pay.
    expect(markup([EVM], [])).toBe("");
  });
});
