import { isEvmChain } from "@/libs/chains/registry";

/**
 * What the deposit summary's "Network fee" row may say — **per chain, and it
 * says something on both**.
 *
 * ## The defect
 *
 * The row was two ternaries on `!isEvmChain(chainId)`. On Solana it read
 * `$0.00` with "paid by us — the facilitator sponsors the transaction"; on
 * `eip155:46630` it rendered a bare `—` and no sentence at all — measured in
 * Chrome under a Robinhood-testnet buyer. That is precisely backwards: the
 * chain where the fee is a solved problem explains itself, and the chain where
 * the buyer has to find native gas says nothing.
 *
 * ## What is true on `eip155`, exactly
 *
 * The facilitator's fee-payer sponsorship is a **Solana** mechanism — it signs
 * as fee payer on a Solana transaction. There is no equivalent on an EVM
 * chain, so nothing about a deposit there is sponsored. The sentence says so
 * WITHOUT naming Solana: on an eip155-only deployment (dev, since 2026-09-23)
 * a chain the buyer cannot use explains nothing and reads as a wrong route.
 *
 * This platform *does* run a bounded, once-per-address-ever gas grant on
 * `eip155`, and it is deliberately **not promised here**. Read
 * `EvmGasGrantService`: one of its eight refusals is `NO_MATURED_WITHDRAWAL`,
 * and the precondition is a matured withdrawal on the chain's own clock. The
 * grant exists to get money *out* of an escrow for a buyer holding USDG and no
 * ETH. A deposit is not a withdrawal, matured or otherwise, so a sentence here
 * offering to cover the fee would be a promise the platform refuses by
 * construction — at the moment somebody is about to send money. It is named,
 * and located, instead.
 *
 * ## Why it is a module
 *
 * The same reason `withdraw-gas-grant-note.ts` is one: a branch written inline
 * in a page component has no test that can reach it, and the branch nobody
 * exercised is the branch that is wrong. Both arms below are reached by
 * `deposit-network-fee.test.ts`, and the test asserts they are *different* —
 * a single shared sentence is the degenerate this file exists to refuse.
 */
export interface DepositNetworkFee {
  /** What goes in the figure column. Never a fabricated amount. */
  readonly value: string;
  /** The row's explanation, or `null` when no chain has been chosen yet. */
  readonly note: string | null;
}

/**
 * `chainId` is `null` until a chain is picked, and that state gets the dash
 * with no sentence: "$0.00, paid by us" before a chain is named is a promise
 * about a chain nobody has chosen, and the EVM sentence would be a warning
 * about a chain nobody has chosen.
 *
 * `chainName` is the display name `GET /chains` served — passed in rather than
 * assembled here, for the same reason nothing in this bundle assembles one.
 */
export function depositNetworkFee(
  chainId: string | null,
  chainName: string | null,
): DepositNetworkFee {
  if (chainId === null) return { value: "—", note: null };

  if (!isEvmChain(chainId)) {
    return {
      value: "$0.00",
      note: "paid by us — the facilitator sponsors the transaction",
    };
  }

  const network = chainName ?? chainId;
  return {
    value: "—",
    note:
      `not sponsored on this chain — a transfer on ${network} costs gas in that network's own ` +
      `native token, paid from your wallet. The one-time network-fee cover this platform offers ` +
      `is for getting money out of escrow, not for putting it in.`,
  };
}
