import Decimal from "decimal.js";

import type { Money, ProviderEarningsFigures } from "@/interfaces";

export const EARNED_IN_WALLET = "already in your wallet — paid at each redemption";

/**
 * The "Earned this month" tile's sub-line.
 *
 * `earned` counts every credited call, and a credit is not always a
 * redemption: when a served call's voucher can never be redeemed (a revoked
 * delegate, a sequence the chain already passed) the buyer keeps the money and
 * the platform credits the provider from its own funds. That slice never
 * reached the provider's wallet, so the tile says so rather than calling all of
 * `earned` "already in your wallet".
 */
export function earnedTileSub(
  totals: ProviderEarningsFigures | null | undefined,
  format: (value: Money) => string,
): string {
  const earned = totals?.earned;
  const absorbed = totals?.absorbed;
  const calls = totals?.absorbedCalls ?? 0;
  if (!earned || !absorbed || calls === 0 || new Decimal(absorbed.amount).isZero()) {
    return EARNED_IN_WALLET;
  }

  const inWallet: Money = {
    ...earned,
    amount: new Decimal(earned.amount).minus(absorbed.amount).toFixed(0),
  };
  return (
    `${format(inWallet)} in your wallet · ${format(absorbed)} owed by the platform for ` +
    `${calls} call${calls === 1 ? "" : "s"} whose voucher could not be redeemed`
  );
}
