import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LedgerEmptyNote } from "@/features/funding/ledger-empty";
import type { FullBalance } from "@/features/g30/balance";
import type { Chain } from "@/interfaces/chain";

import { BALANCE_EXPLAINER, BalanceCards } from "./balance-cards";

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

const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  withdrawable: { amount: "12200000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  chainReadable: true,
};

const EVM_ROW: FullBalance = {
  chainId: EVM,
  accountId: `${EVM}:0x83ab1234567890abcdef1234567890abcdef2913`,
  asset: `${EVM}/erc20:0xa0b8`,
  decimals: 6,
  available: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  held: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  withdrawable: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  chainReadable: true,
};

const EMPTY_NOTE: LedgerEmptyNote = {
  kind: "none",
  text: "No balance to read for this account. Add funds to open one.",
};

function markup(
  balances: FullBalance[],
  chains: Chain[] = CHAINS,
  emptyNote: LedgerEmptyNote = EMPTY_NOTE,
): string {
  return renderToStaticMarkup(
    <BalanceCards balances={balances} chains={chains} emptyNote={emptyNote} />,
  );
}

describe("BalanceCards", () => {
  it("counts a deposit observed on chain and awaiting finality as pending, not $0", () => {
    /*
      Measured on dev 2026-09-25 and 2026-09-29: for the ~20 minutes an
      eip155:46630 deposit waits for finality, the card read "Pending deposit
      $0.00" while the escrow already held the money. The wire carries TWO
      figures — `pendingDeposits` (not yet seen on chain) and `pending` (seen,
      not final) — and the card showed `pendingDeposits ?? pending`, which is
      never `pending` because `pendingDeposits` is always present.
    */
    const settling: FullBalance = {
      ...EVM_ROW,
      available: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
      pending: { amount: "10000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
      pendingDeposits: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
    };
    const html = markup([settling]);
    expect(html).toContain("$10.00");
  });

  it("names the account when two cards share a chain, so they can be told apart", () => {
    /*
      Measured on dev 2026-09-25: an organization with two agents on
      eip155:46630 rendered two identical "Robinhood Chain testnet" cards,
      $35.00 and $0.99, with nothing saying whose money was whose.
    */
    const second: FullBalance = {
      ...EVM_ROW,
      accountId: `${EVM}:0x13b38d7ba84cc8ea5ea5694bebe7be55b8d5317b`,
    };
    const html = markup([EVM_ROW, second]);
    expect(html).toContain("0x83ab…2913");
    expect(html).toContain("0x13b3…317b");
  });

  it("does not add an account label when every card is on its own chain", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).not.toContain("0x83ab…2913");
    expect(html).not.toContain("Agen…1111");
  });

  it("renders one card per chain, and each card names its chain", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html.match(/data-testid="balance-card"/g)).toHaveLength(2);
    expect(html).toContain(`data-chain-id="${SOLANA}"`);
    expect(html).toContain(`data-chain-id="${EVM}"`);
    expect(html).toContain("Solana devnet");
    expect(html).toContain("Robinhood Chain testnet");
  });

  // Paid rails A and B are off on Solana: its balance is not spent on calls.
  it("says a Solana balance serves free calls only, and an EVM one is spent there", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    const cards = html.split('data-testid="balance-card"').slice(1);
    const solana = cards.find((card) => card.includes(SOLANA)) ?? "";
    const evm = cards.find((card) => card.includes(EVM)) ?? "";
    expect(solana).toContain("free calls only here, so it is not spent on calls");
    expect(evm).toContain("held on this chain and spent on this chain");
  });

  it("shows BOTH amounts — the second chain is not dropped", () => {
    // Literals, not `formatMoney(row.available)`: an expectation derived from
    // the same expression the component uses changes with it and can never
    // fail. 12.50 is the first row; 4.00 is the one `primaryBalance` threw away.
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).toContain("$12.50");
    expect(html).toContain("$4.00");
  });

  it("keeps each chain's figures INSIDE that chain's own card", () => {
    // "Both amounts are on the page" is satisfied by a component that renders
    // two cards and puts every number in the first one. The card is the unit
    // that says which chain a figure belongs to, so the figure has to be in it:
    // 12.50 belongs to Solana, 4.00 to eip155, and neither may appear in the
    // other's card.
    const html = markup([SOLANA_ROW, EVM_ROW]);
    const cards = html.split('data-testid="balance-card"').slice(1);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("$12.50");
    expect(cards[0]).not.toContain("$4.00");
    expect(cards[1]).toContain("$4.00");
    expect(cards[1]).not.toContain("$12.50");
  });

  it("shows NO total, on any card or between them", () => {
    // 12.50 USDC + 4.00 USDG = $16.50 of nothing. If this string ever appears,
    // something learned to add two chains.
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).not.toContain("$16.50");
    expect(html).not.toContain("$16.20");
    expect(html.toLowerCase()).not.toContain("total balance");
    expect(html.toLowerCase()).not.toContain("usd equivalent");
  });

  it("prints the explainer verbatim when there is more than one chain", () => {
    expect(markup([SOLANA_ROW, EVM_ROW])).toContain(BALANCE_EXPLAINER);
    expect(BALANCE_EXPLAINER).toBe(
      "Balances are held per chain and are spent on that chain. They cannot be combined.",
    );
  });

  it("omits the explainer on one chain — there is nothing to explain", () => {
    // Assert the loser: a component that always printed it passes the previous
    // test on its own, and would tell a single-chain buyer their money cannot
    // be combined with money they do not have.
    expect(markup([SOLANA_ROW])).not.toContain(BALANCE_EXPLAINER);
  });

  it("renders the ABSENT state for an empty list, not a zero card", () => {
    // The `stake ? … : "—"` crash in one line: an array is always truthy.
    const html = markup([]);
    expect(html.match(/data-testid="balance-card"/g)).toBeNull();
    expect(html).toContain("No balance to read");
    expect(html).not.toContain("$0.00");
  });

  it("still renders a card for a chain GET /chains has not named", () => {
    // The chain list and the balance list are two requests and can disagree
    // for a beat. A card that vanished because its name had not arrived would
    // be a balance the buyer cannot see, which is worse than a card labelled
    // with its CAIP-2 id.
    const html = markup([SOLANA_ROW, EVM_ROW], []);
    expect(html.match(/data-testid="balance-card"/g)).toHaveLength(2);
    expect(html).toContain("$4.00");
    expect(html).toContain("eip155:46630");
  });

  /*
    ── Withdrawable: three states, and none of them may look like another ──

    This block replaces one that asserted the OPPOSITE: "falls through a null
    `withdrawable` to that row's OWN available". That test was green, correct
    about its own premise, and describing a defect. Its premise — that a null
    `withdrawable` means "the chain could not be read" — is only half of what
    the DTO says, and the fallback it locked in is what printed the LEDGER's
    figure under a heading that claims the CHAIN. What survives from it is the
    per-row property, which is asserted in `KILLS 'one row's state marks them
    all'` below.
  */

  it("prints the CHAIN's figure when the chain was read", () => {
    const html = markup([
      {
        ...SOLANA_ROW,
        available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        withdrawable: { amount: "12200000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        chainReadable: true,
      },
    ]);
    expect(html).toContain("$12.20");
    expect(html).toContain('data-chain-read="read"');
    expect(html).not.toContain('data-testid="chain-unreadable-note"');
  });

  it("prints $0.00 for a chain that ANSWERED zero — a read, not an unknown", () => {
    const html = markup([
      {
        ...SOLANA_ROW,
        withdrawable: { amount: "0", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        chainReadable: true,
      },
    ]);
    expect(html).toContain("$0.00");
    expect(html).toContain('data-chain-read="read"');
    // And it must NOT be dressed as an outage: the chain answered.
    expect(html).not.toContain("Unknown");
    expect(html).not.toContain('data-testid="chain-unreadable-note"');
  });

  it("says 'None yet' — not $0.00, not Unknown — for a readable chain with no escrow", () => {
    const html = markup([{ ...SOLANA_ROW, withdrawable: null, chainReadable: true }]);
    expect(html).toContain("None yet");
    expect(html).toContain('data-chain-read="absent"');
    expect(html).not.toContain('data-testid="chain-unreadable-note"');
  });

  it("KILLS the fallback: an UNREADABLE chain prints no figure at all", () => {
    /*
      The shipped defect, exactly. `chainReadable: false` with 9.96 available
      rendered `$9.96` under "Withdrawable" with nothing marking it unconfirmed.
      Three assertions, because each one alone is passable by a different wrong
      implementation:
        - "Unknown" present     — killed by a component that prints $0.00
        - $9.96 appears ONCE    — killed by the `?? available` fallback, which
                                  makes it appear twice (Available + Withdrawable)
        - the note is rendered   — killed by a silent fallback with no signal
    */
    const html = markup([
      {
        ...SOLANA_ROW,
        available: { amount: "9965000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        withdrawable: null,
        chainReadable: false,
      },
    ]);
    expect(html).toContain("Unknown");
    expect(html).toContain('data-chain-read="unreadable"');
    expect(html.match(/\$9\.96/g)).toHaveLength(1);
    expect(html).toContain('data-testid="chain-unreadable-note"');
  });

  it("KILLS 'unreadable looks like zero': the two never render the same value node", () => {
    const unreadable = markup([{ ...SOLANA_ROW, withdrawable: null, chainReadable: false }]);
    const zero = markup([
      {
        ...SOLANA_ROW,
        withdrawable: { amount: "0", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
        chainReadable: true,
      },
    ]);
    // Different text, different state attribute, and a note on exactly one.
    expect(unreadable).toContain("Unknown");
    expect(zero).not.toContain("Unknown");
    expect(zero).toContain("$0.00");
    expect(unreadable).toContain('data-chain-read="unreadable"');
    expect(zero).toContain('data-chain-read="read"');
    expect(unreadable).toContain('data-testid="chain-unreadable-note"');
    expect(zero).not.toContain('data-testid="chain-unreadable-note"');
    /*
      And the colour actually differs. `cn()` in this project silently drops
      custom token classes, so an implementation that "sets" a colour and has
      it merged away would pass every assertion above while rendering the two
      states identically on screen.
    */
    expect(unreadable).toContain("text-warning-600");
    expect(zero).not.toContain("text-warning-600");
  });

  it("KILLS 'one row's state marks them all': the flag is read per card", () => {
    /*
      A response-wide read (`balances[0].chainReadable`) would mark BOTH cards
      on a Solana outage and report a fabricated incident against an EVM chain
      that answered fine. It is the first-row bug this component exists to
      remove, one level down, and invisible while the fixture has one chain.
    */
    const html = markup([
      { ...SOLANA_ROW, withdrawable: null, chainReadable: false },
      {
        ...EVM_ROW,
        available: { amount: "7770000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
        withdrawable: { amount: "7770000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
        chainReadable: true,
      },
    ]);
    const cards = html.split('data-testid="balance-card"').slice(1);
    expect(cards).toHaveLength(2);

    expect(cards[0]).toContain("Unknown");
    expect(cards[0]).toContain('data-testid="chain-unreadable-note"');
    // The outage card must not borrow the other chain's figure either.
    expect(cards[0]).not.toContain("$7.77");

    expect(cards[1]).not.toContain("Unknown");
    expect(cards[1]).not.toContain('data-testid="chain-unreadable-note"');
    // 7.77 twice in the readable card: once Available, once Withdrawable.
    expect(cards[1].match(/\$7\.77/g)).toHaveLength(2);
    expect(cards[1]).not.toContain("$12.50");

    // Exactly one note on the whole page, and it names the chain that failed.
    expect(html.match(/data-testid="chain-unreadable-note"/g)).toHaveLength(1);
    expect(html).toContain(`data-testid="chain-unreadable-note" data-chain-id="${SOLANA}"`);
  });

  it("keeps the LEDGER figures printing through an outage", () => {
    // Available / Held / Pending deposit are ledger facts and do not depend on
    // any chain read. A component that blanked the whole card on
    // `chainReadable: false` would hide money the platform is certain about.
    const html = markup([{ ...SOLANA_ROW, withdrawable: null, chainReadable: false }]);
    expect(html).toContain("$12.50"); // available
    expect(html).toContain("$0.30"); // held
  });
});

describe("BalanceCards — a withdrawal per chain", () => {
  it("gives each chain its OWN withdraw link, and offers no combined one", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).toContain(`href="/funding/escrow?chain=${encodeURIComponent(SOLANA)}"`);
    expect(html).toContain(`href="/funding/escrow?chain=${encodeURIComponent(EVM)}"`);
    /* Two withdrawals, never one. */
    expect(html.toLowerCase()).not.toContain("withdraw all");
    const links = html.match(/href="\/funding\/escrow\?chain=[^"]*"/g) ?? [];
    expect(links).toHaveLength(2);
    /*
      Distinct. Two links to one chain is this whole milestone's bug wearing a
      different shape, and it is exactly what closing over `balances[0]` would
      produce while every other assertion above still passed.
    */
    expect(new Set(links).size).toBe(2);
  });

  it("names each link after the chain it withdraws from", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).toContain("Withdraw from Solana devnet");
    expect(html).toContain("Withdraw from Robinhood Chain testnet");
  });

  it("still links to the right chain when the chain has no display name", () => {
    /*
      The href is built from the ROW; only the label comes from the chain list.
      A card that lost its link because its name had not arrived would be a
      balance the buyer can see and cannot withdraw.
    */
    const html = markup([SOLANA_ROW, EVM_ROW], []);
    expect(html).toContain(`href="/funding/escrow?chain=${encodeURIComponent(EVM)}"`);
  });

  it("draws no withdraw link at all when there are no balances", () => {
    // Length, not truthiness — the empty list renders the absent state, and an
    // orphan withdraw link over it would offer a withdrawal from nothing.
    expect(markup([])).not.toContain("/funding/escrow?chain=");
  });
});

/**
 * The empty state, which used to be a sentence written into this file.
 *
 * Measured in one uninterrupted pass under the credential labelled "demo buyer
 * on Robinhood testnet (holds USDG, holds NO ETH)":
 *
 * ```text
 * GET /balances → {"balances":[],"withheld":[]}
 * GET /escrow   → exists true, balance 500000000
 * /funding      → "No balance to read for this account. Add funds to open one."
 * ```
 *
 * The component cannot tell an empty account from an empty ledger — it is
 * handed one list — so the sentence is now the caller's to compute and this
 * file's job is to prove the component renders what it is given, including the
 * link.
 */
describe("BalanceCards — the empty ledger is not an empty account", () => {
  it("renders the note it is handed, whatever it says", () => {
    const html = markup([], CHAINS, {
      kind: "in-escrow",
      text: "No credited balance on this account yet. Your escrow on Robinhood Chain testnet holds $500.00 on chain.",
      href: "/funding/escrow?chain=eip155%3A46630",
      linkText: "Open your escrow on Robinhood Chain testnet",
    });

    expect(html).toContain("$500.00");
    expect(html).toContain("Robinhood Chain testnet");
    // The hard-coded sentence is gone, not merely unreachable.
    expect(html).not.toContain("No balance to read for this account");
    // And the money is one click away, from here.
    expect(html).toContain('href="/funding/escrow?chain=eip155%3A46630"');
    expect(html).toContain("Open your escrow on Robinhood Chain testnet");
  });

  it("draws NO link for a note that has none", () => {
    const html = markup([], CHAINS, {
      kind: "reading",
      text: "Reading this account's balance…",
    });
    expect(html).toContain("Reading this account");
    expect(html).not.toContain('data-testid="balance-empty-escrow-link"');
  });

  it("still renders cards when there ARE balances — the note is not a hijack", () => {
    const html = markup([SOLANA_ROW, EVM_ROW], CHAINS, {
      kind: "none",
      text: "SHOULD NOT APPEAR",
    });
    expect(html).not.toContain("SHOULD NOT APPEAR");
    expect(html.match(/data-testid="balance-card"/g)).toHaveLength(2);
  });

  it("gives one account holding two assets two cards that name their asset (BUG-R2-B2-01)", () => {
    const other = `${SOLANA}/token:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin`;
    const second: FullBalance = {
      ...EVM_ROW,
      asset: other,
      available: { amount: "499000000", asset: other, decimals: 6 },
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    const html = markup([EVM_ROW, second]);
    console.error = original;

    expect(errors.filter((e) => String(e).includes("same key"))).toEqual([]);
    expect(html.match(/data-testid="balance-card"/g)).toHaveLength(2);
    expect(html).toContain("USDG · ");
    expect(html).toContain("9xQeWvG8… · ");
  });
});
