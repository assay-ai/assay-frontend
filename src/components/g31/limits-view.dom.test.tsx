import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { LimitsView } from "./limits-view";

const EVM = "eip155:46630";

const CHAINS: Chain[] = [
  {
    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
    settlementAssetSymbol: "USDC",
    decimals: 6,
  },
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset: `${EVM}/erc20:0xDbbC`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

/** `["spend-policy"]` seeded `null` = the 404 `SPEND_POLICY_NOT_FOUND` state. */
function markup(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["spend-policy-history"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["agents"], {
    items: [{ agentId: "f64b7b6e", label: "buyer", agentAccount: `${EVM}:0x1810`, chainId: EVM }],
    pageInfo: { nextCursor: null, hasMore: false },
  });
  client.setQueryData(["chains"], { chains: CHAINS });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LimitsView />
    </QueryClientProvider>,
  );
}

describe("LimitsView (Budgets) — an account with no budget yet", () => {
  // BUG-J-BUY-01: the page said "the limits below are what a policy would set"
  // and drew nothing below — no form and no button, so a first policy could
  // not be written from the UI at all.
  it("offers to create the first policy, in the agent's own chain's asset", () => {
    const html = markup();
    expect(html).toContain("No budget yet");
    expect(html).toContain("Set a budget");
    expect(html).toContain("USDG on Robinhood Chain testnet");
    expect(html).not.toContain("USDC");
  });
});
