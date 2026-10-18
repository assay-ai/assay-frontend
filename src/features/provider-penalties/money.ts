import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatMoney, toDecimal } from "@/utils/money";

/** Under this, a penalty figure keeps a third decimal. */
const SMALL = new Decimal("0.1");

/**
 * A penalty figure, one rule on every provider screen and notice: two
 * decimals, and up to three under $0.10 (`$0.036 of a $0.04 penalty`, not
 * `$0.03 of a $0.04`). Truncated like every money figure, never rounded up.
 */
export function penaltyMoney(money: Money | null | undefined): string {
  if (!money) return formatMoney(money);
  return formatMoney(money, { decimals: toDecimal(money).lt(SMALL) ? 3 : 2 });
}
