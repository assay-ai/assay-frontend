import { describe, expect, it } from "vitest";

import type { BuyerEscrow } from "@/interfaces";
import type { Chain } from "@/interfaces/chain";

import { ledgerEmptyNote } from "./ledger-empty";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const CHAINS: Chain[] = [
  {
    chainId: SOLANA,
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: `${SOLANA}/token:4zMM`,
    settlementAssetSymbol: "USDC",
    decimals: 6,
  },
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset: `${EVM}/erc20:0x915Ef7c9`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

/**
 * The live body, verbatim, for the credential labelled "demo buyer on
 * Robinhood testnet (holds USDG, holds NO ETH)" — the account whose
 * `GET /balances` is `{"balances":[]}` and whose escrow holds 500.00 USDG.
 */
function escrow(overrides: Partial<BuyerEscrow> = {}): BuyerEscrow {
  return {
    exists: true,
    chainReadable: true,
    account: `${EVM}:0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc`,
    escrowPda: null,
    escrowTokenAccount: null,
    balance: { amount: "500000000", asset: `${EVM}/erc20:0x915Ef7c9`, decimals: 6 },
    openHolds: { amount: "0", asset: `${EVM}/erc20:0x915Ef7c9`, decimals: 6 },
    spendable: { amount: "500000000", asset: `${EVM}/erc20:0x915Ef7c9`, decimals: 6 },
    withdrawRequested: null,
    withdrawAvailableAt: null,
    serverTime: "2026-09-12T03:25:58.757Z",
    maxVoucherAmount: null,
    maxPerWindow: null,
    spentInWindow: null,
    windowStartedAt: null,
    windowSeconds: 86400,
    observedAt: "2026-09-12T03:25:58.000Z",
    ...overrides,
  };
}

describe("ledgerEmptyNote", () => {
  it("does not tell a buyer with $500 in escrow that they have nothing", () => {
    const note = ledgerEmptyNote({ status: "ready", escrow: escrow() }, CHAINS);

    expect(note.kind).toBe("in-escrow");
    expect(note.text).not.toContain("No balance to read for this account");
    expect(note.text).toContain("$500.00");
    expect(note.text).toContain("Robinhood Chain testnet");
    // And it points at the screen the money is on.
    expect(note.kind === "in-escrow" && note.href).toBe(
      `/funding/escrow?chain=${encodeURIComponent(EVM)}`,
    );
  });

  it("names the escrow's OWN chain, not the first chain in the list", () => {
    /*
      The first chain here is Solana. A note built from `chains[0]` would tell
      an `eip155` buyer their money is on Solana devnet — the same first-row
      defect this codebase has deleted from four other screens. Both
      directions, because one cannot see it.
    */
    const onEvm = ledgerEmptyNote({ status: "ready", escrow: escrow() }, CHAINS);
    const onSolana = ledgerEmptyNote(
      {
        status: "ready",
        escrow: escrow({
          account: `${SOLANA}:AgentDemoFundedWalletAddress1111`,
          balance: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        }),
      },
      CHAINS,
    );

    expect(onEvm.text).toContain("Robinhood Chain testnet");
    expect(onEvm.text).not.toContain("Solana devnet");
    expect(onSolana.text).toContain("Solana devnet");
    expect(onSolana.text).toContain("$12.50");
  });

  it("keeps the original sentence for the account it is TRUE of", () => {
    // No ledger row and no escrow: this buyer really does have nothing here,
    // and "Add funds to open one" really is the next step.
    const note = ledgerEmptyNote(
      { status: "ready", escrow: escrow({ exists: false, balance: null }) },
      CHAINS,
    );
    expect(note).toEqual({
      kind: "none",
      text: "No balance to read for this account. Add funds to open one.",
    });
  });

  it("treats an empty escrow as empty, not as money", () => {
    const note = ledgerEmptyNote(
      { status: "ready", escrow: escrow({ balance: { amount: "0", asset: "x", decimals: 6 } }) },
      CHAINS,
    );
    expect(note.kind).toBe("none");
  });

  it("is a wait while the escrow is being read, and a wait is not a claim", () => {
    const note = ledgerEmptyNote({ status: "loading", escrow: undefined }, CHAINS);
    expect(note.kind).toBe("reading");
    expect(note.text).not.toContain("No balance to read");
    expect(note.text).not.toContain("Add funds to open one");
  });

  it("says unknown, not zero, when the chain or the request failed", () => {
    const failed = ledgerEmptyNote({ status: "error", escrow: undefined }, CHAINS);
    expect(failed.kind).toBe("unknown");
    expect(failed.text).toContain("unknown — not zero");

    const unreadable = ledgerEmptyNote(
      { status: "ready", escrow: escrow({ chainReadable: false, balance: null }) },
      CHAINS,
    );
    expect(unreadable.kind).toBe("unknown");
    expect(unreadable.text).toContain("Robinhood Chain testnet did not answer");
  });
});
