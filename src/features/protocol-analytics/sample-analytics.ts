import Decimal from "decimal.js";

import sampleData from "./sample-data.json";

/** Fictional fixture copied from the supplied HTML; never a live API response. */
export const SAMPLE_DATA = sampleData;
export type SampleDay = (typeof sampleData.daily)[number];
export type SampleTool = (typeof sampleData.tools)[number];
export type AnalyticsRange = "7d" | "30d" | "90d" | "all";
export type DailyMetric = "fees_usd" | "volume_usd" | "paid_calls";
export type SumField =
  | DailyMetric
  | "refunded_usd"
  | "provider_usd"
  | "calls_refunded";

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, all: Infinity };
const SUM_FIELDS: SumField[] = [
  "fees_usd",
  "volume_usd",
  "paid_calls",
  "refunded_usd",
  "provider_usd",
  "calls_refunded",
];

function totals(rows: SampleDay[]) {
  return Object.fromEntries(
    SUM_FIELDS.map((field) => [
      field,
      rows
        .reduce((sum, row) => sum.plus(row[field]), new Decimal(0))
        .toNumber(),
    ]),
  ) as Record<SumField, number>;
}

export function percentChange(
  current: number,
  previous: number | null,
): number | null {
  return previous == null || previous === 0 ? null : current / previous - 1;
}

export function sampleAnalytics(range: AnalyticsRange) {
  const n = RANGE_DAYS[range];
  const rows = n === Infinity ? sampleData.daily : sampleData.daily.slice(-n);
  const previousRows =
    n !== Infinity && sampleData.daily.length >= n * 2
      ? sampleData.daily.slice(-n * 2, -n)
      : null;
  const current = totals(rows);
  const previous = previousRows ? totals(previousRows) : null;
  const uniques = sampleData.uniques.find((row) => row.range === range)!;
  // The supplied fixture treats historical daily payments as completed.
  // A live source must use collected / (collected + refunded), excluding pending.
  const passRate = 1 - current.calls_refunded / current.paid_calls;
  const previousPassRate = previous
    ? 1 - previous.calls_refunded / previous.paid_calls
    : null;
  let agents = 0;
  let tools = 0;
  const growth = sampleData.daily
    .map((row) => {
      agents += row.new_agents;
      tools += row.new_tools;
      return { day: row.day, agents, tools };
    })
    .slice(-rows.length);

  return {
    rows,
    current,
    previous,
    uniques,
    passRate,
    previousPassRate,
    growth,
  };
}

export function formatMoney(value: number, small = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...(value >= 10000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : {
          minimumFractionDigits: small && value < 1 ? 3 : value >= 1000 ? 0 : 2,
          maximumFractionDigits: small && value < 1 ? 3 : value >= 1000 ? 0 : 2,
        }),
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(
    "en-US",
    value >= 10000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { maximumFractionDigits: 0 },
  ).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value);
}

export function formatSampleDate(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}
