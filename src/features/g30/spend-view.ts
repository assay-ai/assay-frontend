import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatMoney, toDecimal } from "@/utils/money";

import type { SummaryGroup } from "./wire";

/**
 * Spend (`/spend`), pure: the headline, the ranked bars and the CSV.
 */

/**
 * "▲ 12%" (the screen adds "vs previous 7 days"), or null when there is nothing
 * to compare — including a previous period with no spend, where "new" would
 * only repeat the headline.
 */
export function changePercent(current: Money | null | undefined, previous: Money | null | undefined): string | null {
  if (!current || !previous) return null;
  const now = toDecimal(current);
  const before = toDecimal(previous);
  if (before.isZero()) return null;
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
  /** Buyer debt (open or written off): served, not collected yet. */
  owedPct: number;
  /** A group with calls and nothing listed: free calls only. */
  free: boolean;
  charged: string;
  notCharged: string | null;
  owed: string | null;
  delta: string | null;
}

/**
 * The summary's not-charged figure: everything not charged and not owed. An
 * older API sends only `withheldTotal`, which was the same figure before buyer
 * debt existed.
 */
function notChargedOf(g: SummaryGroup): Money {
  return g.notChargedTotal ?? g.withheldTotal;
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
      const notCharged = toDecimal(notChargedOf(g));
      const owed = g.owedTotal ? toDecimal(g.owedTotal) : new Decimal(0);
      const pct = (v: Decimal) => (max.isZero() ? 0 : v.div(max).mul(100).toNumber());
      // A row only compares with a previous period that had spend on it: "+$52.50
      // vs before" on a group that is entirely new is the row's own total again.
      const hadBefore = g.comparison ? !toDecimal(g.comparison.chargedTotal).isZero() : false;
      const deltaAmount = g.comparison && hadBefore ? new Decimal(g.comparison.deltaChargedTotal.amount || "0") : null;
      return {
        key: g.key,
        label: labelOf(g.key),
        calls: g.calls,
        chargedPct: pct(charged),
        notChargedPct: pct(notCharged),
        owedPct: pct(owed),
        free: listed.isZero() && g.calls > 0,
        charged: formatMoney(g.chargedTotal),
        notCharged: notCharged.gt(0) ? formatMoney(notChargedOf(g)) : null,
        owed: owed.gt(0) && g.owedTotal ? formatMoney(g.owedTotal) : null,
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
  const header = [options.dimensionHeader, `${options.dimensionHeader} id`, "Asset", "Calls", "Listed", "Charged", "Not charged", "Not charged calls", "Owed", "Owed calls"];
  const rows = groups.map((g) => [
    options.labelOf(g.key),
    g.key,
    options.assetLabel,
    String(g.calls),
    formatMoney(g.listedTotal, { grouped: false, exact: true, symbol: "", decimals: g.listedTotal.decimals }),
    formatMoney(g.chargedTotal, { grouped: false, exact: true, symbol: "", decimals: g.chargedTotal.decimals }),
    formatMoney(notChargedOf(g), { grouped: false, exact: true, symbol: "", decimals: notChargedOf(g).decimals }),
    String(g.notChargedCalls ?? g.refundedCalls),
    g.owedTotal ? formatMoney(g.owedTotal, { grouped: false, exact: true, symbol: "", decimals: g.owedTotal.decimals }) : "0",
    String(g.owedCalls ?? 0),
  ]);
  return [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

/** `spend-by-tool_2026-10-09_2026-10-16.csv` (the end is exclusive, so the last full day is shown). */
export function spendCsvFilename(dimension: string, from: string, to: string): string {
  const end = new Date(new Date(to).getTime() - 1).toISOString().slice(0, 10);
  return `spend-by-${dimension}_${from.slice(0, 10)}_${end}.csv`;
}
