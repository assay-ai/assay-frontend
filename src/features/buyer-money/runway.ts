import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { toDecimal } from "@/utils/money";

/**
 * "At this week's rate, your balance lasts about 6 days."
 *
 * Days of spending left at the average daily charge of the last 7 days.
 * `null` when there is nothing to say: no balance read, or nothing charged
 * this week (a rate of zero lasts forever, which is not a useful sentence).
 */
export function runwayDays(spendable: Money | null | undefined, chargedLast7Days: Money | null | undefined): number | null {
  if (!spendable || !chargedLast7Days) return null;
  const perDay = toDecimal(chargedLast7Days).div(7);
  if (perDay.lte(0)) return null;
  return toDecimal(spendable).div(perDay).toDecimalPlaces(1, Decimal.ROUND_DOWN).toNumber();
}

export function runwayLine(days: number | null): string | null {
  if (days === null) return null;
  if (days < 1) return "At this week's rate, your balance runs out within a day.";
  if (days > 60) return "At this week's rate, your balance lasts more than two months.";
  const whole = Math.floor(days);
  return `At this week's rate, your balance lasts about ${whole} ${whole === 1 ? "day" : "days"}.`;
}

/** The low-balance threshold for the "Add funds" nudge: the $5 deposit minimum. */
export const LOW_BALANCE_MAJOR = "5";

export function isLowBalance(spendable: Money | null | undefined): boolean {
  if (!spendable) return false;
  return toDecimal(spendable).lt(LOW_BALANCE_MAJOR);
}
