import Decimal from "decimal.js";

import { formatMoney } from "@/utils/money";

/**
 * Why a call earned nothing, in the provider's words. Keyed on the call class
 * of the per-call export; the buyer's "Not charged" uses the same classes, so
 * the two sides describe one call the same way.
 */
export interface NotCreditedReason {
  title: string;
  detail: string;
}

const REASONS: Record<string, NotCreditedReason> = {
  PAID_UNCREDITED: {
    title: "Failed our checks",
    detail: "Your API answered, but the result did not pass the tool's checks (a value out of range, a missing field, stale data). The buyer was not charged.",
  },
  SYSTEM_ERROR: {
    title: "Endpoint error (5xx or timeout)",
    detail: "It answered with a server error (5xx) or did not answer within your timeout.",
  },
  REQUEST_ERROR: {
    title: "Request refused (4xx)",
    detail: "It answered with a 4xx error. Usually the agent sent input your API does not accept; check your request mapping.",
  },
  EXCLUDED: {
    title: "Excluded by Assay",
    detail: "Assay's team took these calls out of the count, for example during an incident on our side.",
  },
};

export function notCreditedReason(className: string): NotCreditedReason {
  return (
    REASONS[className] ?? {
      title: "Not credited",
      detail: "These calls did not settle to you.",
    }
  );
}

/**
 * Display amounts for a list of parts that add up to their displayed total.
 *
 * Every amount on screen is truncated to `places` decimals (see
 * `formatDecimal`). Truncating each part on its own can lose a cent per part,
 * so three reasons of $0.81, $0.405 and $0.405 would read $0.81 + $0.40 +
 * $0.40 = $1.61 under a "$1.62 not credited" headline. Here the total is
 * truncated once, each part is truncated, and the cents still missing go to
 * the parts with the largest truncated remainders (ties: earlier part first).
 * All arithmetic is on atomic units (bigint).
 *
 * Returns atomic amounts (as strings, same scale as the input) that are exact
 * multiples of the display step and sum to the truncated total.
 */
export function partsThatAddUp(parts: readonly string[], decimals: number, places = 2): string[] {
  if (parts.length === 0) return [];
  const step = decimals > places ? 10n ** BigInt(decimals - places) : 1n;
  const atomic = parts.map((part) => {
    const value = BigInt(part || "0");
    return value < 0n ? 0n : value;
  });
  const total = atomic.reduce((sum, value) => sum + value, 0n);
  const target = (total / step) * step;
  const floors = atomic.map((value) => (value / step) * step);
  let missing = (target - floors.reduce((sum, value) => sum + value, 0n)) / step;
  const order = atomic
    .map((value, index) => ({ index, remainder: value % step }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const result = [...floors];
  for (const { index } of order) {
    if (missing <= 0n) break;
    result[index] += step;
    missing -= 1n;
  }
  return result.map(String);
}

/** "1 call", "848 calls". */
export function callCount(count: number): string {
  return `${count.toLocaleString("en-US")} call${count === 1 ? "" : "s"}`;
}

/**
 * The classes that passed the check but were not paid: written off
 * (`PAID_UNCOLLECTED`) or forfeited (`PROVIDER_FORFEITED`). The export puts
 * them outside "credited", but they are not "not credited by our checks":
 * Money shows them under "Passed, but not paid". Kept out of the not-credited
 * fold, the reasons add up to `withheld` / `withheldCalls`.
 */
export const PASSED_UNPAID_CLASSES: ReadonlySet<string> = new Set(["PAID_UNCOLLECTED", "PROVIDER_FORFEITED"]);

/** The rows the "Not credited" reasons count, and how many passed-but-unpaid rows were left out. */
export function notCreditedRows<T extends { classification: string }>(rows: readonly T[]): { rows: T[]; passedUnpaid: number } {
  const kept = rows.filter((row) => !PASSED_UNPAID_CLASSES.has(row.classification));
  return { rows: kept, passedUnpaid: rows.length - kept.length };
}

/**
 * What one passed-but-unpaid call is worth to the provider in a drill-down:
 * its share of the listed price, after Assay's fee — the same basis as the
 * line's total (the earnings report sums the provider share), so two $0.45
 * calls at a 10% fee read $0.405 each under a $0.81 total.
 *
 * The export sends 0 as the share of a written-off or forfeited call (nothing
 * was collected), so the share is worked out from the listed price at the fee
 * rate when one rate is known. Without one, the listed price is shown and said
 * to be before the fee.
 */
export function unpaidCallAmount(
  row: { providerAmount: string; priceAmount: string; asset: string; decimals: number },
  /** The fee rate in percent the month's paid calls realised, when it is a single rate. */
  feeRatePercent?: number | null,
): {
  amount: { amount: string; asset: string; decimals: number };
  /** Where the amount comes from, in words; null when it is the export's own share. */
  note: string | null;
} {
  const money = (amount: string) => ({ amount, asset: row.asset, decimals: row.decimals });
  const share = BigInt(row.providerAmount || "0");
  if (share > 0n) return { amount: money(row.providerAmount), note: null };
  const listed = money(row.priceAmount || "0");
  if (feeRatePercent != null && Number.isFinite(feeRatePercent) && feeRatePercent >= 0 && feeRatePercent < 100) {
    const net = new Decimal(listed.amount).mul(new Decimal(100).minus(feeRatePercent)).div(100).toFixed(0, Decimal.ROUND_DOWN);
    return {
      amount: money(net),
      note: `of ${formatMoney(listed, { decimals: 4 })} listed, after Assay's ${feeRatePercent}% fee`,
    };
  }
  return { amount: listed, note: "listed price, before Assay's fee" };
}
