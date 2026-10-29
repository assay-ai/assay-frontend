import Decimal from "decimal.js";

import type { AnalyticsAsset } from "@/services/protocol-analytics.service";
import { formatDecimal } from "@/utils/money";

export const AnalyticsDecimal = Decimal.clone({ precision: 100 });

export function analyticsMoney(
  amount: string | null | undefined,
  asset: AnalyticsAsset | null | undefined,
): string {
  if (amount == null || !asset) return "—";
  return (
    formatDecimal(
      new AnalyticsDecimal(amount).div(
        new AnalyticsDecimal(10).pow(asset.decimals),
      ),
      { decimals: 6, symbol: "" },
    ) + ` ${asset.symbol}`
  );
}

export function analyticsRate(rate: number | null | undefined): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

export function analyticsCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

export function analyticsChange(
  current: string | number | null | undefined,
  previous: string | number | null | undefined,
): string | undefined {
  if (
    current == null ||
    previous == null ||
    new AnalyticsDecimal(previous).isZero()
  )
    return undefined;
  const change = new AnalyticsDecimal(current)
    .div(previous)
    .minus(1)
    .times(100);
  return `${change.isNegative() ? "▼" : "▲"} ${change.abs().toFixed(1)}% vs previous period`;
}
