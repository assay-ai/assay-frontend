import type { FullBalance } from "@/features/g30/balance";
import { formatMoney } from "@/utils/money";

/**
 * What the Overview's single balance tile can honestly say.
 *
 * The tile has one slot and there is no honest single number across two
 * chains: a sum is forbidden — 12.50 USDC and 4.00 USDG are $16.50 of nothing
 * — and "the largest" is an FX rate of 1 assumed silently on the figure a
 * person decides whether they can afford a call by. So on two chains the tile
 * stops being a figure and becomes a count plus a link to Funding, where the
 * cards are.
 *
 * The `multiple` member deliberately carries **no** `balance`. Keeping one
 * there "for later" would leave a chain's money one edit away from the tile,
 * and the whole defect this replaces was a figure that was available and
 * therefore rendered.
 */
export type OverviewBalance =
  | { readonly kind: "absent" }
  | { readonly kind: "single"; readonly balance: FullBalance }
  | { readonly kind: "multiple"; readonly chainCount: number };

export function overviewBalance(balances: readonly FullBalance[]): OverviewBalance {
  if (balances.length === 0) return { kind: "absent" };
  if (balances.length === 1) return { kind: "single", balance: balances[0] };
  return { kind: "multiple", chainCount: balances.length };
}

/**
 * The single tile's sub-line. `available` is what a call can draw on now, so it
 * stays the figure; a deposit still waiting for finality (`pending`, ~17
 * minutes on eip155:46630) or not yet observed (`pendingDeposits`) is named
 * beside it. Without this the tile read "$0.00 available now" while the escrow
 * held the buyer's 20 USDG and /funding listed the deposit — the same two
 * buckets the Funding card's "Pending deposit" row adds.
 */
export function singleBalanceSub(balance: FullBalance): string {
  const inbound = [balance.pending, balance.pendingDeposits].reduce(
    (sum, part) => (part ? sum + BigInt(part.amount) : sum),
    0n,
  );
  if (inbound <= 0n) return "available now";
  const money = { amount: inbound.toString(), asset: balance.asset, decimals: balance.decimals };
  return `available now · ${formatMoney(money)} confirming on chain`;
}
