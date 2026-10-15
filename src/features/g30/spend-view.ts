import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatMoney, toDecimal } from "@/utils/money";

import type { SummaryGroup } from "./wire";

/**
 * Spend (`/spend`), pure: the headline, the ranked bars and the CSV.
 */

/** "▲ 12% vs previous 7 days", or null when there is nothing to compare. */
export function changePercent(current: Money | null | undefined, previous: Money | null | undefined): string | null {
  if (!current || !previous) return null;
  const now = toDecimal(current);
  const before = toDecimal(previous);
  if (before.isZero()) return now.isZero() ? null : "new this period";
  const pct = now.minus(before).div(before).mul(100);
  if (pct.abs().lt(0.5)) return "about the same";
  const rounded = pct.abs().lt(10) ? pct.abs().toFixed(1) : pct.abs().toFixed(0);
  return `${pct.isNegative() ? "▼" : "▲"} ${rounded}%`;
}

/** The previous window's charged total, rebuilt from the per-group comparisons the server sent. */
export function previousTotal(groups: readonly SummaryGroup[]): Money | null {
  const withComparison = groups.filter((g) => g.comparison);
  if (withComparison.length === 0) return null;
  const first = withComparison[0]!.comparison!.chargedTotal;
  const sum = withComparison.reduce((acc, g) => acc.plus(new Decimal(g.comparison!.chargedTotal.amount || "0")), new Decimal(0));
  return { amount: sum.toFixed(0), asset: first.asset, decimals: first.decimals };
}

export interface RankedRow {
  key: string;
  label: string;
  calls: number;
  /** Bar widths, 0–100, relative to the largest listed total. */
  chargedPct: number;
  notChargedPct: number;
  /** A group with calls and nothing listed: free calls only. */
  free: boolean;
  charged: string;
  notCharged: string | null;
  delta: string | null;
}

export function rankRows(groups: readonly SummaryGroup[], labelOf: (key: string) => string): RankedRow[] {
  const max = groups.reduce((m, g) => Decimal.max(m, toDecimal(g.listedTotal)), new Decimal(0));
  return [...groups]
    .sort(
      (a, b) =>
        toDecimal(b.listedTotal).comparedTo(toDecimal(a.listedTotal)) || b.calls - a.calls,
    )
    .map((g) => {
      const listed = toDecimal(g.listedTotal);
      const charged = toDecimal(g.chargedTotal);
      const withheld = toDecimal(g.withheldTotal);
      const pct = (v: Decimal) => (max.isZero() ? 0 : v.div(max).mul(100).toNumber());
      const deltaAmount = g.comparison ? new Decimal(g.comparison.deltaChargedTotal.amount || "0") : null;
      return {
        key: g.key,
        label: labelOf(g.key),
        calls: g.calls,
        chargedPct: pct(charged),
        notChargedPct: pct(withheld),
        free: listed.isZero() && g.calls > 0,
        charged: formatMoney(g.chargedTotal),
        notCharged: withheld.gt(0) ? formatMoney(g.withheldTotal) : null,
        delta:
          deltaAmount && !deltaAmount.isZero()
            ? `${deltaAmount.isNegative() ? "▼ −" : "▲ +"}${formatMoney({ ...g.chargedTotal, amount: deltaAmount.abs().toFixed(0) })}`
            : null,
      };
    });
}

function escape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One CSV row per group: names AND ids, the asset, and plain amounts. */
export function spendCsv(
  groups: readonly SummaryGroup[],
  options: { dimensionHeader: string; labelOf: (key: string) => string; assetLabel: string },
): string {
  const header = [options.dimensionHeader, `${options.dimensionHeader} id`, "Asset", "Calls", "Listed", "Charged", "Not charged", "Not charged calls"];
  const rows = groups.map((g) => [
    options.labelOf(g.key),
    g.key,
    options.assetLabel,
    String(g.calls),
    formatMoney(g.listedTotal, { grouped: false, symbol: "", decimals: g.listedTotal.decimals }),
    formatMoney(g.chargedTotal, { grouped: false, symbol: "", decimals: g.chargedTotal.decimals }),
    formatMoney(g.withheldTotal, { grouped: false, symbol: "", decimals: g.withheldTotal.decimals }),
    String(g.refundedCalls),
  ]);
  return [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

/** `spend-by-tool_2026-10-09_2026-10-16.csv` (the end is exclusive, so the last full day is shown). */
export function spendCsvFilename(dimension: string, from: string, to: string): string {
  const end = new Date(new Date(to).getTime() - 1).toISOString().slice(0, 10);
  return `spend-by-${dimension}_${from.slice(0, 10)}_${end}.csv`;
}
