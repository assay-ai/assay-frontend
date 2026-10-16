"use client";

import { chargedFromTotals, owedFromTotals } from "@/features/g30/spend-buckets";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { localDayBounds } from "@/libs/local-time";
import {
  getBalances,
  getHolds,
  getReceiptsSummary,
  getWithheld,
  listNotifications,
  listToolCalls,
  type AccountBalance,
  type ToolCall,
} from "@/services";
import { toDecimal } from "@/utils/money";

import { monthPeriod, recentDays, type Period } from "./period";
import { readWithheld, type HoldRow, type SummaryWire, type WithheldForAsset } from "./wire";

/** `GET /notifications` — `NotificationDto`, read off the running API. */
export interface NotificationRow {
  id: string;
  event: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  subjectType?: string | null;
  subjectId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface ChartDay {
  /** `2026-08-19`. */
  key: string;
  /** Tool id -> charged, in MAJOR units as a float. */
  byTool: Record<string, number>;
}

export interface OverviewData {
  month: Period;
  /**
   * Every chain's balance, in the API's order. Was `balance: AccountBalance |
   * null`, filled from `balances.balances?.[0]` — which answered a two-chain
   * buyer with one chain's money and no sign the other existed.
   */
  balances: readonly AccountBalance[];
  holds: HoldRow[];
  withheld: WithheldForAsset | null;
  monthListed: Money | null;
  /** Charged since 00:00 in the reader's zone (`localDayBounds`), the day the rows call "Today". */
  todayCharged: Money | null;
  /** Owed today (buyer debt not collected), shown beside the charged figure. */
  todayOwed: Money | null;
  todayCalls: number;
  yesterdayCharged: Money | null;
  chart: ChartDay[];
  /** Tool ids seen in the 7-day window, most-spent first. */
  chartTools: string[];
  recentCalls: ToolCall[];
  notifications: NotificationRow[];
}

export interface OverviewState {
  data: OverviewData | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

/**
 * Bar heights are the one place a money amount becomes a float. Nothing
 * rendered as text comes from this: every figure on the screen still goes
 * through `formatMoney` on the original `Money`. A chart column is pixels, and
 * pixels are not exact anyway.
 */
function toChartNumber(money: Money | undefined | null): number {
  return money ? toDecimal(money).toNumber() : 0;
}

async function loadChart(days: Period[]): Promise<{ chart: ChartDay[]; tools: string[] }> {
  // `GET /receipts/summary` groups by exactly ONE dimension, so a day-by-tool
  // stack costs one request per day. Seven parallel requests is the price of
  // the chart the design draws; there is no two-dimensional grouping to ask
  // for instead.
  const summaries = await Promise.all(
    days.map(
      (d) =>
        getReceiptsSummary({ from: d.from, to: d.to, groupBy: "tool" }) as Promise<SummaryWire>,
    ),
  );

  const totals = new Map<string, number>();
  const chart = summaries.map((summary, i) => {
    const byTool: Record<string, number> = {};
    for (const group of summary.groups ?? []) {
      const value = toChartNumber(group.chargedTotal);
      byTool[group.key] = value;
      totals.set(group.key, (totals.get(group.key) ?? 0) + value);
    }
    return { key: days[i].key, byTool };
  });

  const tools = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { chart, tools };
}

/** `assetKey`: the display-asset pick; a change refetches without a reload. */
export function useOverview(anchor: Date, assetKey: string | null = null): OverviewState {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const month = useMemo(() => monthPeriod(anchor), [anchor]);
  const days = useMemo(() => recentDays(anchor, 7), [anchor]);
  // The reader's own day, the boundary the Recent calls rows' "Today" /
  // "Yesterday" labels use: a UTC day put calls labelled "Yesterday" under
  // "Spent today" east of Greenwich (review 2026-10-17 P3). The API filters
  // `[from, to)` by instant, so any zone's day is one exact window.
  const today = useMemo(() => localDayBounds(anchor), [anchor]);
  const yesterday = useMemo(() => localDayBounds(anchor, { offsetDays: -1 }), [anchor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getBalances(),
      getHolds() as Promise<CursorPage<HoldRow>>,
      getWithheld({ from: month.from, to: month.to }),
      getReceiptsSummary({
        from: month.from,
        to: month.to,
        groupBy: "day",
      }) as Promise<SummaryWire>,
      // Two windows of their own, not rows of the month's (UTC) day groups.
      getReceiptsSummary({ from: today.from, to: today.to, groupBy: "tool" }) as Promise<SummaryWire>,
      getReceiptsSummary({ from: yesterday.from, to: yesterday.to, groupBy: "tool" }) as Promise<SummaryWire>,
      loadChart(days),
      listToolCalls({ limit: 6, sort: "createdAt", order: "desc" }),
      listNotifications({ limit: 5 }) as Promise<CursorPage<NotificationRow>>,
    ])
      .then(([balances, holds, withheldRaw, monthSummary, todaySummary, yesterdaySummary, chart, calls, notes]) => {
        if (cancelled) return;

        const todayGroup = todaySummary.totals;

        setData({
          month,
          balances: balances.balances ?? [],
          holds: holds.items ?? [],
          withheld: readWithheld(withheldRaw, monthSummary.asset),
          monthListed: monthSummary.totals?.listedTotal ?? null,
          // "Spent" is charged only (one meaning on every screen); owed sits beside it.
          todayCharged: chargedFromTotals(todayGroup),
          todayOwed: owedFromTotals(todayGroup),
          todayCalls: todayGroup?.calls ?? 0,
          yesterdayCharged: chargedFromTotals(yesterdaySummary.totals),
          chart: chart.chart,
          chartTools: chart.tools,
          recentCalls: calls.items ?? [],
          notifications: notes.items ?? [],
        });
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError("UNKNOWN", "The overview could not be loaded", 0),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, days, today, yesterday, nonce, assetKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
