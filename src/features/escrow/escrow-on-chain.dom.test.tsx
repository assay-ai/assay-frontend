import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EscrowOnChain, escrowChainProps } from "./escrow-on-chain";

import type { BuyerEscrow } from "@/interfaces";
import type { Chain } from "@/interfaces/chain";

/*
  Rendered markup, not props.

  The measured failure on this codebase is a page that kept compiling, kept its
  tests green and kept building 56/56 while a row vanished from what a person
  could read. So this file renders the component and reads the TEXT and the
  HREFs out of the result, exactly as `relayed-notices.dom.test.tsx` does.

  Both chain fixtures below are the REAL values this deployment's `GET /chains`
  serves, read off `http://127.0.0.1:3101/api/v1/chains` on 2026-09-12 — the
  Solana base carries a query string and the eip155 base does not, and those two
  shapes are the ones `explorerAddressUrl` exists to keep apart.
*/

const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7",
  settlementAssetSymbol: "USDC",
  decimals: 6,
};

const EVM: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  settlementAsset: "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

/** A Solana escrow: both address fields present, as that chain's response carries them. */
const SOLANA_ESCROW = {
  escrowPda: "EscrowPda1111111111111111111111111111111111",
  escrowTokenAccount: "TokenAcct2222222222222222222222222222222222",
  observedAt: "2026-09-12T00:00:00.000Z",
} as unknown as BuyerEscrow;

/**
 * An eip155 escrow, and the two nulls are NOT an outage.
 *
 * Measured against the live API with an open, funded EVM escrow: `exists: true`,
 * `chainReadable: true`, `balance: 400000000`, and BOTH address fields `null`.
 * A fixture that filled them in would be testing a response the backend does
 * not send, and would hide the case this component was written for.
 */
const EVM_ESCROW = {
  escrowPda: null,
  escrowTokenAccount: null,
  observedAt: "2026-09-12T00:00:00.000Z",
} as unknown as BuyerEscrow;

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&rsquo;|’/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&mdash;|—/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefsOf(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'"),
  );
}

function render(props: Parameters<typeof EscrowOnChain>[0]) {
  const markup = renderToStaticMarkup(<EscrowOnChain {...props} />);
  return { markup, text: textOf(markup), hrefs: hrefsOf(markup) };
}

describe("EscrowOnChain on a Solana escrow", () => {
  const { text, hrefs } = render({
    escrow: SOLANA_ESCROW,
    chain: SOLANA,
    chainName: SOLANA.displayName,
  });

  it("names Solana devnet and links Solana's explorer", () => {
    expect(text).toContain("Solana devnet's explorer");
    expect(hrefs).toContain("https://explorer.solana.com/?cluster=devnet");
  });

  it("still shows both addresses the response carries", () => {
    // The whole point of the block: the buyer can go and look. Losing an
    // address while keeping the prose is the exact `rows.length === 0` → `!rows`
    // failure this repo has already paid for once.
    expect(text).toContain("EscrowPda1111111111111111111111111111111111");
    expect(text).toContain("TokenAcct2222222222222222222222222222222222");
  });

  it("links each address through the base's QUERY STRING, not around it", () => {
    /*
      `https://explorer.solana.com/?cluster=devnet` + `/address/X` naively
      concatenated is `…/?cluster=devnet/address/X`, which resolves to the
      explorer's home page — a link that looks like a receipt and is not one.
    */
    expect(hrefs).toContain(
      "https://explorer.solana.com/address/TokenAcct2222222222222222222222222222222222?cluster=devnet",
    );
    expect(hrefs.some((h) => h.includes("cluster=devnet/address"))).toBe(false);
  });
});

describe("EscrowOnChain on an eip155 escrow", () => {
  const { text, hrefs } = render({ escrow: EVM_ESCROW, chain: EVM, chainName: EVM.displayName });

  it("never says Solana", () => {
    // The defect, stated as an assertion. This sentence's only job is to tell a
    // buyer they do not have to trust us; sending them to the wrong chain
    // defeats it precisely where it matters most.
    expect(text).not.toMatch(/solana/i);
    expect(hrefs.every((h) => !h.includes("solana"))).toBe(true);
  });

  it("names this chain and links THIS chain's explorer", () => {
    expect(text).toContain("Robinhood Chain testnet's explorer");
    expect(hrefs).toEqual(["https://explorer.testnet.chain.robinhood.com"]);
  });

  it("does not promise an address it was not given", () => {
    // Both address fields are null on this chain, so "the token account below"
    // would point at empty space.
    expect(text).not.toContain("below");
    expect(text).toContain("held on Robinhood Chain testnet");
  });

  it("still says what the block is for", () => {
    expect(text).toContain("Your balance is not a row in our database");
    expect(text).toContain("without asking us");
  });
});

describe("EscrowOnChain when the chain list is not in hand", () => {
  /*
    `useChains` carries an EMPTY list in both `loading` and `error`, so the page
    hands `chain: null` here. A link is then impossible to build correctly and
    the component must not invent one — the same ruling `TxReference` makes on
    the deposit screen: a link to the wrong chain's explorer is worse than none.
  */
  const { text, hrefs } = render({
    escrow: SOLANA_ESCROW,
    chain: null,
    chainName: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  });

  it("renders no explorer link at all", () => {
    expect(hrefs).toEqual([]);
  });

  it("still shows the addresses, and names the chain by its CAIP-2 label", () => {
    expect(text).toContain("EscrowPda1111111111111111111111111111111111");
    expect(text).toContain("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1's explorer");
  });
});

describe("the two chains do not render the same block", () => {
  it("differs in the chain it names and the explorer it points at", () => {
    /*
      The degenerate this kills: a component that reads the chain from
      `chains[0]` (or from any constant) renders IDENTICAL explorer copy on both
      escrows. Comparing the two renders catches that even if every other
      assertion above were satisfied by the hardcoded value.
    */
    const solana = render({
      escrow: SOLANA_ESCROW,
      chain: SOLANA,
      chainName: SOLANA.displayName,
    });
    const evm = render({ escrow: EVM_ESCROW, chain: EVM, chainName: EVM.displayName });

    expect(solana.hrefs[0]).not.toBe(evm.hrefs[0]);
    expect(new URL(solana.hrefs[0]).host).not.toBe(new URL(evm.hrefs[0]).host);
  });
});

describe("escrowChainProps — which chain the page hands the block", () => {
  /*
    The half a component test cannot see.

    `EscrowOnChain` renders whatever chain it is given, so every assertion above
    is satisfied by a page that picks the WRONG one — `chains[0]`, a constant,
    the chain in `?chain=`. This deployment serves Solana FIRST and eip155
    second, so `chains[0]` is right on exactly one of the two escrows and wrong
    on the other, which is the shape the bug had the first time.
  */
  const CHAINS = [SOLANA, EVM];

  it("picks the escrow's own chain, not the first in the list", () => {
    expect(escrowChainProps(CHAINS, EVM.chainId).chain).toBe(EVM);
    expect(escrowChainProps(CHAINS, EVM.chainId).chainName).toBe("Robinhood Chain testnet");
  });

  it("picks the first one only when the escrow really is on it", () => {
    expect(escrowChainProps(CHAINS, SOLANA.chainId).chain).toBe(SOLANA);
  });

  it("answers null for a chain the API did not serve, and labels it by CAIP-2", () => {
    // The deployment stopped offering this chain, or the list failed. Either
    // way there is no explorer base to build a link from, and the name must not
    // collapse to the namespace — "eip155" alone would read the same for
    // mainnet and for a testnet, which is the difference between real money and
    // not.
    const props = escrowChainProps(CHAINS, "eip155:1");
    expect(props.chain).toBeNull();
    expect(props.chainName).toContain("eip155:1");
  });

  it("answers null while the escrow query has not said which chain it is", () => {
    const props = escrowChainProps(CHAINS, null);
    expect(props.chain).toBeNull();
    expect(props.chainName).toBe("this chain");
  });

  it("answers null, not chains[0], when the chain list is empty", () => {
    // `useChains` carries an EMPTY list in both `loading` and `error`. A `[0]`
    // read there is `undefined`, and `undefined.explorerBaseUrl` is a blank
    // page on a money screen.
    expect(escrowChainProps([], EVM.chainId).chain).toBeNull();
  });
});
