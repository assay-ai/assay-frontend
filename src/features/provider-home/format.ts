import type { Money } from "@/interfaces";
import { formatDecimal, toDecimal } from "@/utils/money";

/**
 * A per-call price as people write it: "$0.10", "$0.0025" — two decimals when
 * the price is whole cents, otherwise as many as it needs (never trailing zeros).
 */
export function callPrice(money: Money | null | undefined): string {
  if (!money) return "Free";
  const value = toDecimal(money);
  if (value.isZero()) return "Free";
  return formatDecimal(value, { decimals: money.decimals });
}
