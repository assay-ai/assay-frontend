import Link from "next/link";
import * as React from "react";

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  UNREADABLE_NOTE,
  chainFigure,
} from "@/features/chain-read/chain-read";
import type { LedgerEmptyNote } from "@/features/funding/ledger-empty";
import { hasMultipleChains, zeroLike, type FullBalance } from "@/features/g30/balance";
import { KeyValueRow } from "@/features/g30/ui";
import type { Chain } from "@/interfaces/chain";
import { shortAddress } from "@/libs/chains/format";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { assetName, chainDisplayName } from "@/services/chains.service";
import { formatMoney } from "@/utils/money";

/**
 * The buyer's money, one card per chain.
 *
 * ## Why there is no total, and why a sentence says so
 *
 * 12.50 USDC on Solana and 4.00 USDG on Robinhood Chain are $16.50 of nothing:
 * a call settles on one chain and draws on that chain's balance alone, and the
 * platform never bridges, never quotes a cross-chain price and never nets one
 * chain against another. So the one number a buyer would read off a total is
 * the one number that is never true.
 *
 * But an interface that simply omits a figure people expect reads as a bug, and
 * a buyer who thinks the app is broken about their money does not stay calm.
 * Hence `BALANCE_EXPLAINER`, printed once under the cards and only when there
 * is more than one — a single-chain buyer has nothing to explain, and telling
 * them their balance cannot be combined with money they do not have is noise.
 *
 * ## Why an unnamed chain still gets a card
 *
 * The chain list and the balance list are two requests. They can disagree for a
 * beat, and they disagree permanently if an operator removes a chain that still
 * holds balances — which is possible and accepted. A card
 * that disappeared because its display name had not arrived would be a balance
 * the buyer cannot see. A card labelled `eip155:46630` is worse-looking and
 * strictly more honest.
 *
 * ## Every figure is read off the row it is drawn in
 *
 * There is no index into `balances` anywhere below — each card closes over its
 * own row, including every fallback. `withdrawable ?? available` reaching for
 * the *first* row's available would be the same defect this component exists to
 * remove, one level down, and it would be invisible for as long as the buyer
 * has one chain.
 *
 * ## Withdrawable, and the three states it is actually in
 *
 * This component used to render `formatMoney(balance.withdrawable ?? available)`.
 * The fallback was reasoned about — "not $0.00 at a buyer who has money" — and
 * it was still wrong, because it answered a question nobody asked. `available`
 * is the LEDGER's figure; "Withdrawable" is a claim about what the CHAIN will
 * pay. With Solana devnet genuinely unreadable, a buyer read `$9.96` under
 * that heading with nothing on the screen marking it unconfirmed.
 *
 * So the row goes through `chainFigure`, and the four renderings are all
 * distinct:
 *
 * ```text
 *  chainReadable  withdrawable   renders        meaning
 *  true           $9.96          "$9.96"        the chain answered
 *  true           {amount:"0"}   "$0.00"        the chain answered: nothing
 *  true           null           "None yet"     no escrow on this chain yet
 *  false          null           "Unknown"      nobody looked
 * ```
 *
 * `chainReadable` is read off **the row**, so an outage on one chain marks one
 * card. A response-wide read would report a Solana RPC failure against an EVM
 * chain that answered fine — a fabricated incident, and the same first-row bug
 * this component exists to remove.
 *
 * Available, Held and Pending deposit are LEDGER facts and are unaffected by
 * any of this. They keep printing through an outage, and the note says so.
 */

/** Product copy. Changing this string changes what the product promises. */
export const BALANCE_EXPLAINER =
  "Balances are held per chain and are spent on that chain. They cannot be combined.";

export interface BalanceCardsProps {
  readonly balances: readonly FullBalance[];
  /** From `useChains()`. Display names only — an empty list still renders every card. */
  readonly chains: readonly Chain[];
  /** The held row's subtitle (`heldCallsText`). Omitted means no subtitle. */
  readonly heldSub?: string;
  /**
   * Whether any deposit is confirming on chain, for the pending row's subtitle.
   * Omitted means no subtitle.
   *
   * It is deliberately NOT per chain: `GET /deposits` is not chain-filtered on
   * this surface today, so a per-card claim here would be a fact the caller
   * cannot actually establish. The figure beside it IS per chain — it comes off
   * the row — and only the sentence is shared.
   */
  readonly depositsConfirming?: boolean;
  /**
   * What to say when `balances` is empty — computed by `ledgerEmptyNote()`
   * from the escrow read, and **required** so that no caller can fall back to
   * the sentence that shipped here as a literal.
   *
   * It was `"No balance to read for this account. Add funds to open one."`,
   * unconditional, and it was read in Chrome by a buyer with $500.00 of USDG
   * in escrow on `eip155:46630`. An empty ledger is not an empty account, and
   * this component cannot tell the difference on its own — it is handed one
   * list. So the distinction is made by the caller, which has the escrow, and
   * arrives here as a prop with nowhere to default.
   */
  readonly emptyNote: LedgerEmptyNote;
}

export function BalanceCards({
  balances,
  chains,
  heldSub,
  depositsConfirming,
  emptyNote,
}: BalanceCardsProps) {
  if (balances.length === 0) {
    /*
      Length, not truthiness. `balances ? … : …` is always the first branch —
      that is the crash that already shipped in providers-view.tsx:112, where
      an empty array took the "we have data" path and threw inside decimal.js.
    */
    return (
      <Panel>
        <PanelBody className="flex-col items-start gap-2 px-5 py-4">
          <p data-testid="balance-empty-note" data-state={emptyNote.kind} className="text-body-sm text-02">
            {emptyNote.text}
          </p>
          {emptyNote.kind === "in-escrow" ? (
            <Link
              href={emptyNote.href}
              data-testid="balance-empty-escrow-link"
              className="text-body-13 text-primary-500 underline"
            >
              {emptyNote.linkText}
            </Link>
          ) : null}
        </PanelBody>
      </Panel>
    );
  }

  /*
    Chains carrying more than one card. An organization with two agents on one
    chain gets two cards with the same title, and only the account tells them
    apart — so on those cards, and only those, the account is named.
  */
  const sharedChains = new Set(
    balances
      .map((balance) => balance.chainId)
      .filter((chainId, index, all) => all.indexOf(chainId) !== index),
  );

  /*
    Accounts carrying more than one card: one account, two assets. `GET
    /balances` is one row per (account, asset), so those cards name the asset —
    otherwise the same account reads as two different balances.
  */
  const sharedAccounts = new Set(
    balances
      .map((balance) => balance.accountId)
      .filter((accountId, index, all) => all.indexOf(accountId) !== index),
  );

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {balances.map((balance) => (
          <Panel
            key={`${balance.accountId}|${balance.asset}`}
            data-testid="balance-card"
            data-chain-id={balance.chainId}
            className="min-w-0"
          >
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>{chainDisplayName(chains, balance.chainId)}</PanelTitle>
                <PanelDescription>
                  {sharedChains.has(balance.chainId)
                    ? `${accountLabel(balance)} · `
                    : null}
                  {sharedAccounts.has(balance.accountId)
                    ? `${assetName(chains, balance.asset)} · `
                    : null}
                  {servesPaidCalls(balance.chainId)
                    ? "held on this chain and spent on this chain"
                    : "held on this chain · free calls only here, so it is not spent on calls"}
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-[18px] pt-2">
              <KeyValueRow
                label="Available"
                sub="spendable now, on this chain"
                value={formatMoney(balance.available)}
              />
              <KeyValueRow
                label="Held"
                sub={heldSub}
                value={formatMoney(balance.held)}
              />
              <KeyValueRow
                label="Pending deposit"
                sub={
                  depositsConfirming === undefined && !hasObservedPending(balance)
                    ? undefined
                    : depositsConfirming || hasObservedPending(balance)
                      ? "confirming on chain"
                      : "nothing confirming"
                }
                value={formatMoney(pendingTotal(balance))}
              />
              {(() => {
                /*
                  Computed per card, inside the map, from THIS row's own two
                  fields. Nothing here can reach `balances[0]`, and nothing
                  here takes an amount as an input in the unreadable branch —
                  see `chainFigure`.
                */
                const figure = chainFigure(balance.chainReadable, balance.withdrawable, {
                  absentText: "None yet",
                });
                return (
                  <>
                    <KeyValueRow
                      label="Withdrawable"
                      sub={
                        figure.state === "unreadable"
                          ? "we could not read this chain — unknown, not zero"
                          : figure.state === "absent"
                            ? "no escrow on this chain yet — a deposit opens one"
                            : "what a withdrawal would move, read from the chain"
                      }
                      value={figure.text}
                      valueState={figure.state}
                      total
                    />
                    {figure.state === "unreadable" ? (
                      /*
                        Per card, naming its own chain. A buyer must be able to
                        tell, from the card alone, that the figure above it is
                        missing rather than zero — and which chain is the one
                        that did not answer.
                      */
                      <p
                        data-testid="chain-unreadable-note"
                        data-chain-id={balance.chainId}
                        className="pt-2 text-body-xs leading-[1.55] text-warning-700"
                      >
                        {UNREADABLE_NOTE} The figures above it are this platform&apos;s ledger for{" "}
                        {chainDisplayName(chains, balance.chainId)} and are unaffected; what that
                        chain would actually pay out is not known until it answers again.
                      </p>
                    ) : null}
                  </>
                );
              })()}
              {/*
                Withdraw is per chain, from that chain's card: two
                withdrawals, never one.

                One link per card, carrying THIS card's chain — closed over the
                row like every figure above it, never `balances[0].chainId`.
                There is deliberately no "Withdraw all": it would be a
                cross-chain operation the platform does not perform, and the
                screen behind it would have to choose a chain the buyer did not.
              */}
              <div className="pt-2">
                <Link
                  href={`/funding/escrow?chain=${encodeURIComponent(balance.chainId)}`}
                  className="text-body-13 text-primary-500 underline"
                >
                  Withdraw from {chainDisplayName(chains, balance.chainId)}
                </Link>
              </div>
            </PanelBody>
          </Panel>
        ))}
      </div>

      {hasMultipleChains(balances) ? (
        <p data-testid="balance-explainer" className="text-body-xs text-03">
          {BALANCE_EXPLAINER}
        </p>
      ) : null}
    </div>
  );
}

/** The account's own address, shortened the chain's way — CAIP-10 is `ns:ref:address`. */
function accountLabel(balance: FullBalance): string {
  return shortAddress(balance.chainId, balance.accountId.split(":").slice(2).join(":"));
}

/*
  Money on its way in, in BOTH of the wire's buckets: `pendingDeposits` (a
  deposit not yet seen on chain) and `pending` (seen, not final — ~20 minutes
  on eip155:46630). This read `pendingDeposits ?? pending`, which is never
  `pending` because `pendingDeposits` is always present, so a deposit waiting
  for finality showed "$0.00" while the escrow already held it.
*/
function pendingTotal(balance: FullBalance) {
  const parts = [balance.pendingDeposits, balance.pending].filter(
    (part): part is NonNullable<typeof part> => part !== undefined && part !== null,
  );
  if (parts.length === 0) return zeroLike(balance.available);
  const amount = parts.reduce((sum, part) => sum + BigInt(part.amount), 0n);
  return { ...parts[0], amount: amount.toString() };
}

function hasObservedPending(balance: FullBalance): boolean {
  return balance.pending !== undefined && balance.pending !== null && BigInt(balance.pending.amount) > 0n;
}
