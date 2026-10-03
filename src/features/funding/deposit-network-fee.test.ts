import { describe, expect, it } from "vitest";

import { depositNetworkFee } from "./deposit-network-fee";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

describe("depositNetworkFee", () => {
  it("explains itself on BOTH chains, and says two different things", () => {
    const solana = depositNetworkFee(SOLANA, "Solana devnet");
    const evm = depositNetworkFee(EVM, "Robinhood Chain testnet");

    // The defect: `eip155` rendered `—` with `sub === undefined`.
    expect(solana.note).not.toBeNull();
    expect(evm.note).not.toBeNull();

    // The degenerate: one sentence for both. A shared explanation would be
    // wrong on whichever chain it was not written for, and this is the only
    // assertion that can see it.
    expect(evm.note).not.toBe(solana.note);
  });

  it("names each chain's own mechanism", () => {
    expect(depositNetworkFee(SOLANA, "Solana devnet")).toEqual({
      value: "$0.00",
      note: "paid by us — the facilitator sponsors the transaction",
    });

    const evm = depositNetworkFee(EVM, "Robinhood Chain testnet");
    expect(evm.value).toBe("—");
    expect(evm.note).toContain("not sponsored on this chain");
    expect(evm.note).toContain("Robinhood Chain testnet");
    expect(evm.note).toContain("native token");
  });

  it("does NOT promise the gas grant on a deposit", () => {
    /*
      `EvmGasGrantService` refuses `NO_MATURED_WITHDRAWAL` — the grant exists
      for getting money OUT of an escrow. A deposit is not a withdrawal, so a
      sentence here offering to cover the fee would be a promise the platform
      refuses by construction, at the moment somebody is about to send money.
      The sentence may NAME the cover; it may not offer it.
    */
    const note = depositNetworkFee(EVM, "Robinhood Chain testnet").note ?? "";
    expect(note).toContain("getting money out of escrow, not for putting it in");
    expect(note).not.toMatch(/we (cover|pay|sponsor) (your|the) (gas|network fee)/i);
  });

  it("does not explain an eip155 fee by naming Solana", () => {
    /*
      Measured on dev 2026-09-25, a deployment serving `eip155:46630` ONLY:
      the row told the buyer "the facilitator signs as fee payer on Solana".
      A chain the deployment does not offer is not an explanation; it reads as
      though the deposit were somehow going to Solana.
    */
    const note = depositNetworkFee(EVM, "Robinhood Chain testnet").note ?? "";
    expect(note).not.toMatch(/solana/i);
  });

  it("says nothing at all before a chain is chosen", () => {
    expect(depositNetworkFee(null, null)).toEqual({ value: "—", note: null });
  });

  it("falls back to the chain id rather than inventing a network name", () => {
    expect(depositNetworkFee(EVM, null).note).toContain(EVM);
  });
});
