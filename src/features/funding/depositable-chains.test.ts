import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import {
  depositUnavailableOn,
  depositableChains,
  offeredChains,
} from "./depositable-chains";

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
  settlementAsset: "eip155:46630/erc20:0x915Ef7c9",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

const CHAINS = [SOLANA, EVM];

describe("depositableChains", () => {
  it("offers ONLY the chain this buyer holds an account on", () => {
    /*
      Both directions, because one direction cannot tell the narrowing from
      `chains[0]`: an implementation that always returns the first chain passes
      the Solana line and offers Solana to the EVM buyer — which is the exact
      defect, measured in Chrome.
    */
    expect(
      offeredChains(depositableChains(CHAINS, { status: "ready", chainId: EVM.chainId })),
    ).toEqual([EVM]);
    expect(
      offeredChains(depositableChains(CHAINS, { status: "ready", chainId: SOLANA.chainId })),
    ).toEqual([SOLANA]);
  });

  it("offers nothing while the account is being read — a default is the defect", () => {
    const result = depositableChains(CHAINS, { status: "loading", chainId: null });
    expect(result.kind).toBe("reading-account");
    expect(offeredChains(result)).toEqual([]);
  });

  it("falls back to the deployment's list when the account could NOT be read", () => {
    /*
      Deliberately permissive, and the cost is bounded: `POST /deposits` runs
      before any wallet is opened and refuses an unlinked chain by name (409
      PAYMENT_DEPOSIT_ACCOUNT_NOT_LINKED). Blocking deposits because an
      unrelated escrow read failed would take away the thing that still works.
    */
    const result = depositableChains(CHAINS, { status: "error", chainId: null });
    expect(result.kind).toBe("unfiltered");
    expect(offeredChains(result)).toEqual(CHAINS);
  });

  it("offers NOTHING ELSE when the buyer's chain is not on offer", () => {
    const result = depositableChains(CHAINS, { status: "ready", chainId: "eip155:1" });
    expect(result).toEqual({ kind: "not-offered", accountChainId: "eip155:1" });
    expect(offeredChains(result)).toEqual([]);
  });

  it("reports the empty chain list as its own state, ahead of the account", () => {
    expect(depositableChains([], { status: "ready", chainId: EVM.chainId })).toEqual({
      kind: "no-chains",
    });
  });
});

describe("depositUnavailableOn", () => {
  const EMBEDDED = { kind: "embedded" as const, rpcConfigured: true };

  it("stays silent on solana whatever the wallet", () => {
    expect(depositUnavailableOn(SOLANA.chainId, "Solana devnet", EMBEDDED)).toBeNull();
    expect(
      depositUnavailableOn(SOLANA.chainId, "Solana devnet", {
        kind: "external",
        rpcConfigured: false,
      }),
    ).toBeNull();
  });

  it("takes an eip155 deposit from an embedded wallet when the build has an RPC", () => {
    expect(depositUnavailableOn(EVM.chainId, "Robinhood Chain testnet", EMBEDDED)).toBeNull();
  });

  it("takes an eip155 deposit from an injected wallet too — it sends, and the hash is settled", () => {
    // Refused until 2026-09-29: MetaMask and Rabby cannot sign without
    // sending. They now SEND `depositFor` and the backend settles by hash
    // (`POST /deposits/:id/broadcast`).
    expect(
      depositUnavailableOn(EVM.chainId, "Robinhood Chain testnet", {
        kind: "external",
        rpcConfigured: true,
      }),
    ).toBeNull();
  });

  it("refuses eip155 when this build has no RPC for the chain", () => {
    const note =
      depositUnavailableOn(EVM.chainId, "Robinhood Chain testnet", {
        kind: "embedded",
        rpcConfigured: false,
      }) ?? "";
    expect(note).toContain("aren't available right now");
  });

  it("does not refuse on a guess while the wallet is still resolving", () => {
    expect(
      depositUnavailableOn(EVM.chainId, "Robinhood Chain testnet", {
        kind: null,
        rpcConfigured: true,
      }),
    ).toBeNull();
  });

  it("says nothing before a chain is chosen", () => {
    expect(depositUnavailableOn(null, null, EMBEDDED)).toBeNull();
  });

  it("keys on the namespace, so a second EVM chain gets the same answer", () => {
    expect(
      depositUnavailableOn("eip155:1", "Ethereum", {
        kind: "external",
        rpcConfigured: false,
      }),
    ).toContain("aren't available right now");
  });
});
