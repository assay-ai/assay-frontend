"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
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

import { dayPeriod, monthPeriod, recentDays, type Period } from "./period";
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
  todayCharged: Money | null;
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

export function useOverview(anchor: Date): OverviewState {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const month = useMemo(() => monthPeriod(anchor), [anchor]);
  const days = useMemo(() => recentDays(anchor, 7), [anchor]);
  const today = useMemo(() => dayPeriod(anchor), [anchor]);
  const yesterday = useMemo(
    () => dayPeriod(new Date(anchor.getTime() - 86_400_000)),
    [anchor],
  );

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
      // Spans a month boundary on the 1st, which is exactly why this is its own
      // window rather than two rows picked out of the month's day groups.
      getReceiptsSummary({
        from: yesterday.from,
        to: today.to,
        groupBy: "day",
      }) as Promise<SummaryWire>,
      loadChart(days),
      listToolCalls({ limit: 6, sort: "createdAt", order: "desc" }),
      listNotifications({ limit: 5 }) as Promise<CursorPage<NotificationRow>>,
    ])
      .then(([balances, holds, withheldRaw, monthSummary, recentSummary, chart, calls, notes]) => {
        if (cancelled) return;

        const byDay = new Map((recentSummary.groups ?? []).map((g) => [g.key, g]));
        const todayGroup = byDay.get(today.key);

        setData({
          month,
          balances: balances.balances ?? [],
          holds: holds.items ?? [],
          withheld: readWithheld(withheldRaw),
          monthListed: monthSummary.totals?.listedTotal ?? null,
          todayCharged: todayGroup?.chargedTotal ?? null,
          todayCalls: todayGroup?.calls ?? 0,
          yesterdayCharged: byDay.get(yesterday.key)?.chargedTotal ?? null,
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
  }, [month, days, today, yesterday, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
