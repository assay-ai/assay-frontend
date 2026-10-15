import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import type { DepositableChains } from "./depositable-chains";
import { addFundsTile, depositMethodLabel, fundingAssetNote } from "./settlement-asset";

/**
 * TWO chains, and the two settle in DIFFERENT tokens.
 *
 * That is the whole point of the fixture. With one chain — or with two chains
 * that both settle in USDC — every assertion below passes for an
 * implementation that returns `chains[0].settlementAssetSymbol`, which is the
 * literal `"USDC"` this module exists to delete. `eip155:46630` settles in
 * USDG, so a first-row answer is visibly wrong.
 */
const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
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

const CHAINS = [SOLANA, EVM];

/** A second paid chain with its own token, so two buyers' tiles can differ. */
const EVM_USDC: Chain = {
  ...EVM,
  chainId: "eip155:8453",
  displayName: "Base",
  settlementAsset: "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  settlementAssetSymbol: "USDC",
};

function linked(...chains: Chain[]): DepositableChains {
  return { kind: "linked", chains };
}

describe("depositMethodLabel — the deposits table's Method column", () => {
  it("answers per row, not per table", () => {
    // Both, in one assertion. `cell: () => "USDC"` — the shipped code — passes
    // the first line alone and mislabels every Robinhood-testnet deposit.
    expect(depositMethodLabel(CHAINS, SOLANA.chainId)).toBe("USDC");
    expect(depositMethodLabel(CHAINS, EVM.chainId)).toBe("USDG");
  });

  it("is a dash, not a guess, for a chain the list does not carry", () => {
    expect(depositMethodLabel(CHAINS, "eip155:1")).toBe("—");
    expect(depositMethodLabel([], SOLANA.chainId)).toBe("—");
  });
});

describe("addFundsTile", () => {
  it("names THIS buyer's asset and network, not the first chain's", () => {
    const base = addFundsTile(linked(EVM_USDC));
    const evm = addFundsTile(linked(EVM));

    expect(base.title).toBe("Send USDC");
    expect(base.sub).toContain("Base");
    expect(evm.title).toBe("Send USDG");
    expect(evm.sub).toContain("Robinhood Chain testnet");

    // The degenerate this kills: one tile for everybody.
    expect(evm.title).not.toBe(base.title);
    expect(evm.sub).not.toBe(base.sub);
  });

  // Paid rails A and B are off on Solana, so a deposit there would fund nothing.
  it("offers no deposit on a chain that serves free calls only", () => {
    const tile = addFundsTile(linked(SOLANA));
    expect(tile.title).toBe("Add funds");
    expect(tile.sub).toBe("Solana devnet currently serves free calls only · no deposits for now");
    // Beside a paid chain, the free-only one is simply not named.
    expect(addFundsTile({ kind: "unfiltered", chains: CHAINS }).title).toBe("Send USDG");
  });

  it("never carries the deleted claims", () => {
    for (const tile of [addFundsTile(linked(SOLANA)), addFundsTile(linked(EVM))]) {
      // A settlement time nothing on the wire reports.
      expect(tile.sub).not.toContain("40s");
      // A deposit-address flow this product does not have.
      expect(tile.sub).not.toContain("deposit address");
    }
    // And the EVM tile must not say "Solana" at all.
    expect(addFundsTile(linked(EVM)).sub).not.toContain("Solana");
  });

  it("names both when both are offered, and de-duplicates equal symbols", () => {
    expect(addFundsTile({ kind: "unfiltered", chains: [EVM_USDC, EVM] }).title).toBe(
      "Send USDC or USDG",
    );

    const mainnet: Chain = { ...EVM_USDC, chainId: "eip155:1", displayName: "Ethereum" };
    // Two chains, one symbol. "Send USDC or USDC" is a screen nobody trusts.
    expect(addFundsTile({ kind: "unfiltered", chains: [EVM_USDC, mainnet] }).title).toBe(
      "Send USDC",
    );
  });

  it("names no asset and no network while nothing is known", () => {
    for (const state of [
      { kind: "no-chains" } as const,
      { kind: "reading-account" } as const,
    ]) {
      const tile = addFundsTile(state);
      expect(tile.title).toBe("Add funds");
      expect(tile.title + tile.sub).not.toContain("USDC");
      expect(tile.title + tile.sub).not.toContain("USDG");
      expect(tile.title + tile.sub).not.toContain("Solana");
    }
  });

  it("says so when the buyer's chain takes no deposits, rather than offering another", () => {
    const tile = addFundsTile({ kind: "not-offered", accountChainId: "eip155:1" });
    expect(tile.sub).toContain("not one we take deposits on");
    expect(tile.title + tile.sub).not.toContain("USDC");
  });
});

describe("fundingAssetNote", () => {
  it("names the buyer's own token", () => {
    expect(fundingAssetNote(linked(EVM))).toContain("You fund the account with USDG");
    expect(fundingAssetNote(linked(EVM_USDC))).toContain("You fund the account with USDC");
    // No token is named for a chain that takes no deposits (free calls only).
    expect(fundingAssetNote(linked(SOLANA))).not.toContain("USDC");
  });

  it("keeps the chain-independent half in every state", () => {
    for (const state of [
      linked(SOLANA),
      linked(EVM),
      { kind: "no-chains" } as const,
      { kind: "not-offered", accountChainId: "eip155:1" } as const,
    ]) {
      expect(fundingAssetNote(state)).toContain("no card and no fiat on-ramp");
    }
  });

  it("names nothing when no chain is in hand", () => {
    const note = fundingAssetNote({ kind: "no-chains" });
    expect(note).not.toContain("USDC");
    expect(note).not.toContain("USDG");
  });
});

describe("an API that does not serve the symbol yet", () => {
  /*
    `Chain` is a hand mirror; the field is required in TypeScript and optional
    in reality, because a backend one deploy behind serves the same JSON
    without it. Measured live in exactly that state: the tile rendered "Send"
    and the note read "You fund the account with and you can withdraw…".
  */
  const noSymbol = { ...EVM, settlementAssetSymbol: undefined } as unknown as Chain;

  it("degrades to asset-neutral wording, never to a dangling sentence", () => {
    const tile = addFundsTile(linked(noSymbol));
    expect(tile.title).toBe("Send your chain's settlement token");
    expect(tile.title.trim()).not.toBe("Send");
    // The network is a different field and is still known.
    expect(tile.sub).toContain("Robinhood Chain testnet");

    const note = fundingAssetNote(linked(noSymbol));
    expect(note).toContain("the settlement token of the chain you deposit on");
    expect(note).not.toContain("with and");
  });

  it("still names the symbols it DOES have", () => {
    expect(addFundsTile({ kind: "unfiltered", chains: [EVM_USDC, noSymbol] }).title).toBe(
      "Send USDC",
    );
  });
});
