import type { BuyerEscrow } from "@/interfaces";
import type { Chain } from "@/interfaces/chain";
import { chainDisplayName } from "@/services/chains.service";
import { chainIdOfAccount } from "@/utils/chain";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * What `/funding` may say when `GET /balances` comes back with **no rows**.
 *
 * ## The defect
 *
 * It said: *"No balance to read for this account. Add funds to open one."*
 *
 * Measured, in one pass, for the credential labelled "demo buyer on Robinhood
 * testnet (holds USDG, holds NO ETH)":
 *
 * ```text
 * GET /balances → {"balances":[],"withheld":[]}
 * GET /escrow   → exists true, balance 500000000  (500.00 USDG)
 * ```
 *
 * So the first screen a buyer checks told them they had nothing, while $500.00
 * of their money sat one click away on the Escrow screen. The sentence was not
 * hedged and not conditional — it asserted a fact about money that it had not
 * established, on the screen people open *to find out about their money*.
 *
 * ## What is NOT the fix
 *
 * Making `/balances` mirror the escrow. The two are different things and the
 * product depends on the difference: the ledger row is credited, spendable
 * platform balance; the escrow balance is on-chain custody the settlement
 * contract holds. A buyer can have one without the other in both directions —
 * that is what a deposit *is*, moving the second into the first. Folding them
 * would be the same false statement pointing the other way, and it would break
 * every screen that reasons about a deposit in flight.
 *
 * The fix is that an empty ledger stops claiming an empty account. It reports
 * what it actually read, and says where the other half lives.
 *
 * ## Why the old sentence is kept
 *
 * For the account it is true of. A buyer with no ledger row **and** no escrow
 * genuinely has nothing here and genuinely needs to deposit, and "Add funds to
 * open one" is the right instruction. Deleting it to fix the other case would
 * trade one wrong screen for another.
 */
export type LedgerEmptyNote =
  /** The escrow read has not answered. A loading state, never a claim. */
  | { readonly kind: "reading"; readonly text: string }
  /** Nobody could look. Unknown is stated as unknown. */
  | { readonly kind: "unknown"; readonly text: string }
  /** Nothing credited here, money on chain. Says how much, and links to it. */
  | {
      readonly kind: "in-escrow";
      readonly text: string;
      readonly href: string;
      readonly linkText: string;
    }
  /** Nothing credited and nothing in escrow: the original sentence, unchanged. */
  | { readonly kind: "none"; readonly text: string };

export interface EscrowRead {
  readonly status: "loading" | "error" | "ready";
  readonly escrow: BuyerEscrow | undefined;
}

const NOT_CREDITED = "No credited balance on this account yet.";

export function ledgerEmptyNote(read: EscrowRead, chains: readonly Chain[]): LedgerEmptyNote {
  /*
    Error BEFORE loading, and the order is load-bearing.

    A failed query also carries `data: undefined`, so testing
    `escrow === undefined` first renders a failure as a spinner — the screen
    then waits forever for something that has already stopped, which is the
    same shape as the `networkMode` defect the queries on this page were
    written to avoid. `ledger-empty.test.ts` is what caught it here.
  */
  if (read.status === "error") {
    return {
      kind: "unknown",
      text: `${NOT_CREDITED} We could not read your escrow just now, so whether it holds anything on chain is unknown — not zero.`,
    };
  }

  if (read.status === "loading" || read.escrow === undefined) {
    return {
      kind: "reading",
      text: "Reading this account's balance…",
    };
  }

  const escrow = read.escrow;
  const chainId = chainIdOfAccount(escrow.account);
  const network = chainId ? chainDisplayName(chains, chainId) : "this account's chain";

  if (escrow.chainReadable !== true) {
    return {
      kind: "unknown",
      text: `${NOT_CREDITED} ${network} did not answer, so whether your escrow holds anything on chain is unknown — not zero.`,
    };
  }

  if (escrow.balance !== null && toDecimal(escrow.balance).gt(0)) {
    return {
      kind: "in-escrow",
      text: `${NOT_CREDITED} Your escrow on ${network} holds ${formatMoney(escrow.balance)} on chain — that is yours, and it is what paid calls draw on. Nothing has been credited to this platform's ledger for this account.`,
      href: chainId ? `/funding/escrow?chain=${encodeURIComponent(chainId)}` : "/funding/escrow",
      linkText: `Open your escrow on ${network}`,
    };
  }

  return {
    kind: "none",
    text: "No balance to read for this account. Add funds to open one.",
  };
}
