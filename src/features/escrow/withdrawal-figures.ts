/**
 * @fileoverview
 * The three figures a buyer's withdrawal screen shows, and why they are three.
 *
 * `request_withdraw(amount)` does not reserve anything. It writes a **ceiling**
 * onto `BuyerEscrow` and starts a clock; the escrow keeps serving redemptions
 * the whole time the clock runs. When `withdraw()` finally executes, the
 * program pays `min(requested, escrow_ata.amount)` — so the amount the buyer
 * asked for and the amount they receive are two different numbers, and between
 * the request and the claim the second one can only fall.
 *
 * A screen that printed one number would have to pick which lie to tell: show
 * the request and a buyer who has spent since is told they will receive money
 * they will not, or show the balance and the record of what they signed for
 * disappears. So this returns all three — the ceiling, the live balance, and
 * the payout — and marks the payout **"at most"** for as long as it can still
 * move.
 *
 * **`balance`, not `spendable`.** `spendable` is `balance − openHolds`, which
 * is the right figure for *whether a new call can be paid* and the wrong one
 * for *what a withdrawal pays out*: the program's `withdraw` reads
 * `escrow_ata.amount` and knows nothing about this platform's ledger holds.
 * Subtracting them here would under-report the payout — and a buyer whose
 * holds close before they claim would receive more than the screen promised,
 * which is the pleasant direction of a defect that is still a defect. Verified
 * against the assay-backend repository,
 * assay-backend `src/modules/settlement/services/escrow-account.service.ts` (where
 * `spendable` is computed off-chain from `LedgerHoldRepository`) and the
 * controller docstring on `POST /escrow/withdrawals/intent` ("Pays
 * `min(requested, escrow_ata.amount)`").
 *
 * **No clock in here.** Maturity arrives as a boolean the caller took from
 * `useCountdown(escrow.withdrawAvailableAt)`. This module never sees a
 * duration, never adds `WITHDRAW_DELAY_SECONDS` to anything, and has no `Date`
 * in it at all — the program compares against the cluster's clock, and a figure
 * derived from `now + delay` in a browser is wrong in the direction that tells
 * a buyer their money is ready before it is.
 *
 * **No JS numbers.** Every amount here is an atomic `u64` as a decimal string.
 * `Number("18446744073709551615")` is already the wrong integer, so the only
 * comparison performed is a `Decimal` one, and the returned `Money` objects are
 * the *inputs themselves* rather than anything recomputed — no scaling, no
 * rounding, no arithmetic that could produce an amount the chain will not move.
 */

import type { BuyerEscrow, Money } from "@/interfaces";
import { toDecimal } from "@/utils/money";

/**
 * The qualifier on the payout row.
 *
 * `"at most"` while the wait is still running: the escrow is still live, a
 * redemption can still land, and the number can still fall. `null` once
 * `withdrawAvailableAt` has passed, where the figure is what `withdraw()`
 * would pay if it were sent now — still not a promise (a redemption in the
 * seconds before the transaction lands would lower it), but no longer a
 * figure with a known-open window in front of it.
 */
export type PayoutQualifier = "at most" | null;

export interface WithdrawalFigures {
  /**
   * The ceiling the buyer signed for in `request_withdraw` —
   * `BuyerEscrow.withdraw_requested`. `"0"` when nothing stands.
   */
  requested: Money;
  /** `escrow_ata.amount`, live off the chain. Not `spendable`; see the file doc. */
  balance: Money;
  /**
   * `min(requested, balance)` — what `withdraw()` pays. One of the two inputs
   * by identity, never a recomputed amount.
   */
  payout: Money;
  /** `"at most"` while the wait runs. Render it beside {@link payout}, not instead of it. */
  qualifier: PayoutQualifier;
  /**
   * True when the balance is below the request — the escrow has already been
   * drawn down past what the buyer asked for, so the payout row is the balance
   * and not the request. This is the case worth a sentence on screen.
   */
  cappedByBalance: boolean;
  /** True when a request actually stands (`requested > 0`). */
  pending: boolean;
}

/**
 * `null` when there are no figures to show — no escrow account, or a response
 * that carried no balance. Both are `exists: false` territory, which is a
 * different screen (open one with a deposit) and not "zero".
 *
 * @param matured Whether `escrow.withdrawAvailableAt` has passed, as measured
 * by the app's one clock (`useCountdown`). Not derived here on purpose: two
 * clocks in one screen is how a countdown reads "under a minute" beside a
 * figure that has already dropped its qualifier.
 */
export function withdrawalFigures(
  escrow: BuyerEscrow,
  { matured }: { matured: boolean },
): WithdrawalFigures | null {
  const balance = escrow.balance;
  if (!escrow.exists || !balance) return null;

  // A null `withdrawRequested` on an existing escrow means the same thing the
  // backend's `"0"` means — nothing was requested. Denominated in the
  // balance's own asset so the two rows are comparable and the payout row can
  // be either of them.
  const requested: Money = escrow.withdrawRequested ?? {
    amount: "0",
    asset: balance.asset,
    decimals: balance.decimals,
  };

  const cappedByBalance = toDecimal(balance).lt(toDecimal(requested));
  const payout = cappedByBalance ? balance : requested;

  return {
    requested,
    balance,
    payout,
    qualifier: matured ? null : "at most",
    cappedByBalance,
    pending: toDecimal(requested).gt(0),
  };
}
