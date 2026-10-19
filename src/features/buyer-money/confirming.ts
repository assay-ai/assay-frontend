import type { FullBalance } from "@/features/g30/balance";
import type { Money } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * Money that is in (or on its way to) the escrow but that paid calls cannot use
 * yet (BUG-A-06). The ledger credits a deposit only once the chain has
 * finalised it — about 17 to 27 minutes on eip155:46630 — so between the
 * transfer and finality the chain's escrow balance already counts it while a
 * paid call is refused with `PAYMENT_INSUFFICIENT_FUNDS`.
 *
 * `pending` (seen on chain, not final) and `pendingDeposits` (sent, not yet
 * seen) are the two ledger buckets for it, the same two the Overview tile adds.
 */
export const CONFIRMING_TEXT = "still confirming on chain (usually within 30 minutes)";

/** The deposit sheet's success line, matching what the ledger actually does. */
export const DEPOSIT_CREDIT_TEXT =
  "Paid calls can use it once the chain finalises it, usually within 30 minutes; until then it shows as still confirming on chain.";

/** The ledger row for the escrow's chain, or null when there is none or more than one. */
export function escrowLedgerRow(balances: readonly FullBalance[] | undefined, chainId: string | null): FullBalance | null {
  if (!balances || !chainId) return null;
  const rows = balances.filter((row) => row.chainId === chainId);
  return rows.length === 1 ? rows[0]! : null;
}

/** `pending + pendingDeposits` for this row, or null when nothing is confirming. */
export function confirmingOnChain(row: FullBalance | null | undefined): Money | null {
  if (!row) return null;
  const sum = [row.pending, row.pendingDeposits].reduce((total, part) => (part ? total + BigInt(part.amount || "0") : total), 0n);
  if (sum <= 0n) return null;
  return { amount: sum.toString(), asset: row.asset, decimals: row.decimals };
}

/**
 * What paid calls can use now. Unchanged (`chainSpendable`) while nothing is
 * confirming; while a deposit is, the ledger's `available` caps it, because the
 * ledger is what holds a call's price and the chain already counts the deposit.
 */
export function readyForPaidCalls(chainSpendable: Money | null, row: FullBalance | null | undefined): Money | null {
  if (!row || !confirmingOnChain(row)) return chainSpendable;
  if (!chainSpendable) return row.available;
  return BigInt(row.available.amount || "0") < BigInt(chainSpendable.amount || "0") ? row.available : chainSpendable;
}

/** "$20.00 still confirming on chain (usually within 30 minutes)", or null. */
export function confirmingLine(row: FullBalance | null | undefined): string | null {
  const confirming = confirmingOnChain(row);
  return confirming ? `${formatMoney(confirming)} ${CONFIRMING_TEXT}` : null;
}
