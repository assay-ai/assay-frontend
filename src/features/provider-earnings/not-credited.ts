import Decimal from "decimal.js";

import type { Money, NotCreditedClass, ProviderEarningsFigures, ProviderEarningsGroup } from "@/interfaces";
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

/** One "Not credited" reason as Money lists it: its calls, its worth and the tools it happened on. */
export interface NotCreditedReasonRow {
  readonly className: NotCreditedClass;
  readonly calls: number;
  readonly amount: Money | null;
  /** The tool ids with calls of this class, from the per-tool groups. */
  readonly toolIds: string[];
}

/** "Not credited" for a window: one breakdown, and a summary that is its sum. */
export interface NotCreditedBreakdown {
  readonly calls: number;
  readonly amount: Money | null;
  /** Reasons with calls, most calls first. Empty when the backend sent no breakdown. */
  readonly reasons: NotCreditedReasonRow[];
}

/**
 * "Not credited" from the earnings report: the reasons are its
 * `withheldByClass` (every call of the window, not the capped per-call file),
 * and the summary is their sum — so the Money split, the reasons, the Explain
 * drawer and the provider home all read the same calls (UX review 2026-10-18,
 * D-P0-1: 14 calls in the summary beside 22 in its reasons).
 *
 * The tools per reason come from `groups` when they are per tool. An older
 * backend sends no breakdown: the summary is then `withheld` and there are no
 * reasons to list.
 */
export function notCreditedBreakdown(
  totals: ProviderEarningsFigures | null | undefined,
  groups: readonly ProviderEarningsGroup[] = [],
): NotCreditedBreakdown {
  const byClass = totals?.withheldByClass;
  if (!byClass) {
    return { calls: totals?.withheldCalls ?? 0, amount: totals?.withheld ?? null, reasons: [] };
  }
  const reasons = byClass
    .filter((row) => row.calls > 0)
    .map((row, index) => ({
      index,
      className: row.class,
      calls: row.calls,
      amount: row.amount,
      toolIds: groups
        .filter((group) => group.withheldByClass?.some((g) => g.class === row.class && g.calls > 0))
        .map((group) => group.key),
    }))
    .sort((a, b) => b.calls - a.calls || a.index - b.index)
    .map(({ index: _index, ...reason }) => reason);
  const denom = byClass.find((row) => row.amount)?.amount ?? totals?.withheld ?? null;
  const amount = denom
    ? { ...denom, amount: byClass.reduce((sum, row) => sum + BigInt(row.amount?.amount || "0"), 0n).toString() }
    : null;
  return { calls: byClass.reduce((sum, row) => sum + row.calls, 0), amount, reasons };
}

/**
 * The reasons' amounts as shown: whole cents that add up to the shown total
 * (see {@link partsThatAddUp}), so the cards never sum to a cent more or less
 * than the summary above them.
 */
export function shownReasonAmounts(reasons: readonly NotCreditedReasonRow[]): (Money | null)[] {
  const decimals = reasons.find((reason) => reason.amount)?.amount?.decimals ?? 6;
  const shown = partsThatAddUp(reasons.map((reason) => reason.amount?.amount ?? "0"), decimals);
  return reasons.map((reason, index) => (reason.amount ? { ...reason.amount, amount: shown[index] } : null));
}

/**
 * The tools a reason happened on, by name. A tool the catalogue no longer
 * lists is counted, not named, and said to be removed, as the listings call
 * it (V1-9): "geocode_place, get_weather +8 removed tools", never "a tool, a
 * tool, …". Null when there is nothing to say, and while the catalogue loads
 * (`pending`), when every tool would read as removed.
 */
export function toolsLine(
  toolIds: readonly string[],
  toolName: (toolId: string) => string | null,
  pending = false,
): string | null {
  if (pending) return null;
  const named = [...new Set(toolIds.map(toolName).filter((name): name is string => Boolean(name)))];
  const unnamed = toolIds.length - toolIds.filter((id) => toolName(id)).length;
  const others = unnamed > 0 ? `${unnamed} removed tool${unnamed === 1 ? "" : "s"}` : null;
  if (named.length === 0) return others;
  return others ? `${named.join(", ")} +${others}` : named.join(", ");
}

/**
 * The settlement's three figures rounded once, from cents: the fee and the net
 * are whole cents that add up to the shown gross, so "Gross − fee = Net" holds
 * on screen ($6.76 − $0.68 = $6.08, not $6.76 − $0.67 = $6.08). Every place that
 * shows the fee or the net uses this, so the two read the same everywhere.
 */
export function settlementShown(
  net: Money | null | undefined,
  fee: Money | null | undefined,
): { net: Money | null; fee: Money | null; gross: Money | null } {
  const denom = net ?? fee ?? null;
  if (!denom) return { net: null, fee: null, gross: null };
  const [shownNet, shownFee] = partsThatAddUp([net?.amount ?? "0", fee?.amount ?? "0"], denom.decimals);
  const gross = (BigInt(shownNet) + BigInt(shownFee)).toString();
  return {
    net: net ? { ...net, amount: shownNet } : null,
    fee: fee ? { ...fee, amount: shownFee } : null,
    gross: { ...denom, amount: gross },
  };
}
