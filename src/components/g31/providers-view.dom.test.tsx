import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderCard } from "./providers-view";
import type { ChainStake } from "./format";
import type { ProviderRow } from "./use-catalogue";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const USDC_SOLANA = `${SOLANA}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;
const CHAIN_4663 = "eip155:4663";
const USDC_4663 = `${CHAIN_4663}/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`;

function row(stake: ChainStake[]): ProviderRow {
  return {
    providerId: "a965eec3-0000-4000-8000-000000000000",
    name: "Acme Maritime AS",
    verified: true,
    verifiedAt: "2026-06-02T00:00:00.000Z",
    tier: "NEW",
    toolIds: ["get_weather"],
    activeBindings: 1,
    fromPrice: { amount: "2500", asset: USDC_SOLANA, decimals: 6 },
    stake,
    quality: 0.95,
    measuredCalls: 16000,
    yourCalls: 0,
  };
}

function markup(stake: ChainStake[]): string {
  return renderToStaticMarkup(<ProviderCard provider={row(stake)} />);
}

/**
 * The rendered Stake stat, cut out of the card.
 *
 * Scoped deliberately: asserting `$90.00` against the whole card would also
 * pass on the `From` price beside it, which is the sort of test that keeps
 * passing after the thing it names has gone.
 */
function stakeStat(html: string): string {
  const start = html.indexOf('data-testid="provider-stake"');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf(">From<", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("providers explorer · the stake stat, rendered", () => {
  it("renders the dash for an empty list instead of throwing", () => {
    const stat = stakeStat(markup([]));
    expect(stat).toContain('data-chains="0"');
    expect(stat).toContain("—");
    // Absent, never zero: `$0.00` would read as "nothing at risk", which is a
    // much stronger claim than "we could not read it".
    expect(stat).not.toContain("$");
  });

  it("renders one chain as a bare figure", () => {
    const stat = stakeStat(
      markup([{ chainId: SOLANA, amount: "90000000", asset: USDC_SOLANA, decimals: 6 }]),
    );
    expect(stat).toContain('data-chains="1"');
    expect(stat).toContain("$90.00");
    // Nothing to disambiguate, so the common case reads as it always has.
    expect(stat).not.toContain("solana:EtWT");
  });

  it("renders two chains as two labelled figures and never their sum", () => {
    const stat = stakeStat(
      markup([
        { chainId: SOLANA, amount: "90000000", asset: USDC_SOLANA, decimals: 6 },
        { chainId: CHAIN_4663, amount: "40000000", asset: USDC_4663, decimals: 6 },
      ]),
    );
    expect(stat).toContain('data-chains="2"');
    expect(stat).toContain("$90.00");
    expect(stat).toContain("$40.00");
    expect(stat).toContain("solana:EtWT…");
    expect(stat).toContain("eip155:4663");
    // Two chains are two different assets; adding them advertises protection
    // no single call has.
    expect(stat).not.toContain("$130.00");
  });
});
