import type { FullBalance } from "@/features/g30/balance";
import type { Money } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * Money that is in (or on its way to) the escrow but that paid calls cannot use
 * yet (BUG-A-06). The ledger credits a deposit once the chain confirms it
 * (on eip155 the sequencer's soft confirmation, swept every 5 seconds), so for
 * those few seconds the chain's escrow balance already counts it while a paid
 * call is refused with `PAYMENT_INSUFFICIENT_FUNDS`.
 *
 * `pending` (seen on chain, not final) and `pendingDeposits` (sent, not yet
 * seen) are the two ledger buckets for it, the same two the Overview tile adds.
 */
export const CONFIRMING_TEXT = "still confirming on chain (usually a few seconds)";

/** The deposit sheet's success line, matching what the ledger actually does. */
export const DEPOSIT_CREDIT_TEXT =
  "Paid calls can use it once the chain confirms it, usually within a few seconds; until then it shows as still confirming on chain.";

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

/** Poll `/balances` this often while a deposit has been confirming for less than {@link CONFIRMING_FAST_FOR_MS}. */
export const CONFIRMING_POLL_MS = 3_000;
/** How long the fast poll lasts: a deposit normally confirms within seconds. */
export const CONFIRMING_FAST_FOR_MS = 120_000;
/** After that, a deposit stuck confirming (say, a settlement the backend never finishes) is checked this often. */
export const CONFIRMING_SLOW_POLL_MS = 30_000;

/** The `/balances` poll for a deposit that has been confirming for `elapsedMs`: fast at first, then slow. */
export function confirmingPollMs(elapsedMs: number): number {
  return elapsedMs < CONFIRMING_FAST_FOR_MS ? CONFIRMING_POLL_MS : CONFIRMING_SLOW_POLL_MS;
}

/** Whether any ledger row still has a deposit confirming on chain. */
export function anyConfirming(balances: readonly FullBalance[] | undefined): boolean {
  return (balances ?? []).some((row) => confirmingOnChain(row) !== null);
}

/**
 * What paid calls can use now. Unchanged (`chainSpendable`) while nothing is
 * confirming; while a deposit is, the ledger's `available` caps it, because the
 * ledger is what holds a call's price and the chain already counts the deposit.
 */
export function readyForPaidCalls(
  chainSpendable: Money | null,
  row: FullBalance | null | undefined,
  uncredited?: Money | null,
): Money | null {
  /*
    Money on chain the ledger has not credited (lot 1 A3, `GET /escrow`
    `uncreditedOnChain`) is counted by the chain and usable by no agent: the
    headline is what agents can spend, the ledger's `available`, as on
    Overview, the wallet menu and Close account. Without the field (an older
    backend) nothing changes.
  */
  const uncreditedAmount = positiveMoney(uncredited);
  if (uncreditedAmount && chainSpendable) {
    const capped = BigInt(chainSpendable.amount || "0") - BigInt(uncreditedAmount.amount);
    const chainUsable: Money = { ...chainSpendable, amount: (capped > 0n ? capped : 0n).toString() };
    if (!row) return chainUsable;
    return BigInt(row.available.amount || "0") < BigInt(chainUsable.amount) ? row.available : chainUsable;
  }
  if (!row || !confirmingOnChain(row)) return chainSpendable;
  if (!chainSpendable) return row.available;
  return BigInt(row.available.amount || "0") < BigInt(chainSpendable.amount || "0") ? row.available : chainSpendable;
}

function positiveMoney(money: Money | null | undefined): Money | null {
  return money && BigInt(money.amount || "0") > 0n ? money : null;
}

/** "$5.00 on chain, not yet usable by agents" when `GET /escrow` reports uncredited money, else null (lot 1 A3). */
export function uncreditedLine(uncredited: Money | null | undefined): string | null {
  const amount = positiveMoney(uncredited);
  return amount ? `${formatMoney(amount)} on chain, not yet usable by agents` : null;
}

/** "$20.00 still confirming on chain (usually a few seconds)", or null. */
export function confirmingLine(row: FullBalance | null | undefined): string | null {
  const confirming = confirmingOnChain(row);
  return confirming ? `${formatMoney(confirming)} ${CONFIRMING_TEXT}` : null;
}
