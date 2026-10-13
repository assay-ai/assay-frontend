import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Money, ProviderChainStake } from "@/interfaces";
import type { Chain } from "@/interfaces/chain";

import { StakeByChain } from "./stake-by-chain";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";
const STAKE_ASSET = `${SOLANA}/token:AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7`;

const CHAINS: Chain[] = [
  {
    chainId: SOLANA,
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: STAKE_ASSET,
    settlementAssetSymbol: "USDC",
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

const usdc = (amount: string): Money => ({ amount, asset: STAKE_ASSET, decimals: 6 });

function chain(overrides: Partial<ProviderChainStake> = {}): ProviderChainStake {
  return {
    chainId: SOLANA,
    hasKnownStake: true,
    staked: usdc("500000000"),
    observedAt: "2026-09-11T15:03:54.381Z",
    unbonding: null,
    unbondingStartedAt: null,
    unbondingCompletesAt: null,
    chainReadable: true,
    stakeAuthority: null,
    ...overrides,
  };
}

function markup(
  stake: ProviderChainStake[],
  chains: Chain[] = CHAINS,
  status: "loading" | "error" | "ready" = "ready",
): string {
  return renderToStaticMarkup(<StakeByChain stake={stake} chains={chains} status={status} />);
}

describe("StakeByChain — the live regression", () => {
  it("prints the provider's REAL $500 on a chain that answered", () => {
    /*
      The exact `GET /providers/me/stake` body for `mcp_demo_token_provider` on
      2026-09-11. The shipped page rendered "The chain could not be read" and
      four em dashes for it.
    */
    const html = markup([chain()]);
    expect(html).toContain("$500.00");
    expect(html).toContain('data-chain-read="read"');
    expect(html).toContain("Solana devnet");
    // And no outage is claimed against a chain that answered.
    expect(html).not.toContain('data-testid="stake-chain-unreadable"');
    expect(html).not.toContain("could not read");
  });

  it("KILLS 'an array is truthy': an empty list is an absent state, not a row", () => {
    const html = markup([]);
    expect(html).toContain('data-testid="stake-by-chain-empty"');
    expect(html).not.toContain('data-testid="stake-chain-row"');
    // "not a stake of zero" is the copy; there must be no $0.00 figure.
    expect(html).not.toContain('data-chain-read="read"');
  });
});

describe("StakeByChain — three states, visually distinct", () => {
  it("prints $0.00 for a source that ANSWERED zero", () => {
    const html = markup([chain({ hasKnownStake: true, staked: usdc("0") })]);
    expect(html).toContain("$0.00");
    expect(html).toContain('data-chain-read="read"');
    expect(html).not.toContain("text-warning-600");
  });

  it("prints Unknown — not $0.00 — when the source has no reading", () => {
    const html = markup([chain({ hasKnownStake: false, staked: null, observedAt: null })]);
    expect(html).toContain("Unknown");
    expect(html).toContain('data-chain-read="unreadable"');
    // Neither a zero nor a fabricated observation stamp.
    expect(html).not.toContain("$0.00");
    expect(html).toContain("no reading taken");
  });

  it("KILLS 'unreadable looks like zero': different text AND different colour", () => {
    const unknown = markup([chain({ hasKnownStake: false, staked: null })]);
    const zero = markup([chain({ hasKnownStake: true, staked: usdc("0") })]);
    expect(unknown).toContain("Unknown");
    expect(zero).not.toContain("Unknown");
    expect(unknown).toContain("text-warning-600");
    expect(zero).not.toContain("text-warning-600");
    /*
      Colour asserted because `cn()` in this project silently drops custom token
      classes: an implementation that "sets" the colour and has it merged away
      passes every text assertion while rendering the two states identically.
    */
  });

  it("marks an unreadable CHAIN separately from an unknown stake reading", () => {
    // Two different unknowns: the source answered $500, the chain did not
    // answer about unbonding. One row, two states, and both are told the truth.
    const html = markup([chain({ hasKnownStake: true, chainReadable: false })]);
    expect(html).toContain("$500.00");
    expect(html).toContain('data-testid="stake-chain-unreadable"');
    expect(html).toContain("Unknown"); // the unbonding figure
  });

  it("says 'enrolled, nothing to read' rather than nothing at all", () => {
    const html = markup([chain({ chainReadable: true, stakeAuthority: null })]);
    expect(html).toContain('data-testid="stake-chain-no-authority"');
    expect(html).not.toContain('data-testid="stake-chain-unreadable"');
  });

  // BUG-R4-D-05: "Staked $500.00" stood next to "no stake account to read".
  it("never says there is no stake account next to a staked figure", () => {
    const staked = markup([chain({ stakeAuthority: null })]);
    expect(staked).toContain("$500.00");
    expect(staked).not.toContain("no stake account to read");
    const empty = markup([chain({ stakeAuthority: null, staked: null })]);
    expect(empty).toContain("no stake account to read");
  });
});

describe("StakeByChain — a list, never a sum", () => {
  it("renders one row per chain, each naming its own chain", () => {
    const html = markup([
      chain({ chainId: SOLANA, staked: usdc("500000000") }),
      chain({ chainId: EVM, staked: usdc("80000000") }),
    ]);
    expect(html.match(/data-testid="stake-chain-row"/g)).toHaveLength(2);
    expect(html).toContain(`data-chain-id="${SOLANA}"`);
    expect(html).toContain(`data-chain-id="${EVM}"`);
    expect(html).toContain("$500.00");
    expect(html).toContain("$80.00");
    // 500 + 80. If this ever appears, something learned to add two chains.
    expect(html).not.toContain("$580.00");
  });

  it("keeps each chain's figures INSIDE that chain's own row", () => {
    const html = markup([
      chain({ chainId: SOLANA, staked: usdc("500000000") }),
      chain({ chainId: EVM, staked: usdc("80000000") }),
    ]);
    const rows = html.split('data-testid="stake-chain-row"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("$500.00");
    expect(rows[0]).not.toContain("$80.00");
    expect(rows[1]).toContain("$80.00");
    expect(rows[1]).not.toContain("$500.00");
  });

  it("KILLS a response-wide outage banner: one chain's failure marks ONE row", () => {
    /*
      The shipped banner keyed on a single `data.chainReadable`. Per chain, an
      RPC outage on Solana must not be reported against an EVM chain that
      answered — that is a fabricated incident on somebody's capital screen.
    */
    const html = markup([
      chain({ chainId: SOLANA, chainReadable: false, hasKnownStake: false, staked: null }),
      chain({ chainId: EVM, chainReadable: true, staked: usdc("80000000") }),
    ]);
    expect(html.match(/data-testid="stake-chain-unreadable"/g)).toHaveLength(1);
    expect(html).toContain(
      `data-testid="stake-chain-unreadable" data-chain-id="${SOLANA}"`,
    );
    const rows = html.split('data-testid="stake-chain-row"').slice(1);
    expect(rows[1]).not.toContain('data-testid="stake-chain-unreadable"');
    expect(rows[1]).toContain("$80.00");
  });

  it("still renders a row for a chain GET /chains has not named", () => {
    // The chain list and the stake list are two requests. A row that vanished
    // because its display name had not arrived would be collateral the
    // provider cannot see.
    const html = markup([chain({ chainId: EVM })], []);
    expect(html.match(/data-testid="stake-chain-row"/g)).toHaveLength(1);
    expect(html).toContain(EVM);
    expect(html).toContain("$500.00");
  });
});

/**
 * The loading flash — measured in Chrome, twice, and then held open on purpose.
 *
 * `/provider/capital` derives this component's `stake` prop with
 * `stakeChains(data)`, and `data` is `undefined` while the query is pending.
 * So the empty branch rendered on the FIRST paint of every load, and its
 * sentence is a factual claim: "No chain is enrolled for this organization
 * yet… This is not a stake of zero." Under `mcp_demo_token_provider`, who has
 * $500.00 bonded on Solana devnet and a chain that answered `chainReadable:
 * true`, with the request delayed three seconds:
 *
 * ```text
 * EMPTY: No chain is enrolled for this organization yet, so there is nothing
 *        to read a stake from. This is not a stake of zero.
 * ROWS:  1
 * ```
 *
 * A loading state that is byte-identical to a claim is not a loading state,
 * and this one asserted the opposite of the truth.
 */
describe("StakeByChain — loading is not a claim", () => {
  it("renders three DISTINGUISHABLE empty-ish states", () => {
    const loading = markup([], CHAINS, "loading");
    const failed = markup([], CHAINS, "error");
    const unenrolled = markup([], CHAINS, "ready");

    // The degenerate this kills: a loading state copied from the unenrolled
    // one. Byte equality is exactly what the browser showed.
    expect(loading).not.toBe(unenrolled);
    expect(failed).not.toBe(unenrolled);
    expect(loading).not.toBe(failed);

    expect(loading).toContain('data-testid="stake-by-chain-loading"');
    expect(failed).toContain('data-testid="stake-by-chain-error"');
    expect(unenrolled).toContain('data-testid="stake-by-chain-empty"');
  });

  it("makes NO claim about enrolment while loading", () => {
    const loading = markup([], CHAINS, "loading");
    expect(loading).not.toContain("No chain is enrolled");
    expect(loading).not.toContain("not a stake of zero");
    expect(loading).toContain("Reading your stake");
  });

  it("keeps the unenrolled sentence for the organization it is written for", () => {
    // It is correct copy and it is load-bearing — an org with no chain must
    // not read $0.00. Giving loading its own state must not cost this one.
    const unenrolled = markup([], CHAINS, "ready");
    expect(unenrolled).toContain("No chain is enrolled for this organization yet");
    expect(unenrolled).toContain("This is not a stake of zero");
    expect(unenrolled).not.toContain("$0.00");
  });

  it("still draws every row once the read has answered", () => {
    // The loading branch must not swallow real data: a `status` that is never
    // flipped to "ready" would be a permanently empty capital screen.
    const ready = markup([chain({ chainId: SOLANA }), chain({ chainId: EVM })], CHAINS, "ready");
    expect(ready.match(/data-testid="stake-chain-row"/g)).toHaveLength(2);
    expect(ready).toContain("Solana devnet");
    expect(ready).toContain("Robinhood Chain testnet");
  });
});
