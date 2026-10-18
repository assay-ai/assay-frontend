"use client";

import { chargedCallsFromTotals, chargedFromTotals, owedFromTotals } from "@/features/g30/spend-buckets";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { utcDayBounds } from "@/libs/utc-time";
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

import { attentionRows } from "./alert-model";
import { monthPeriod, recentDays, type Period } from "./period";

/** Needs attention shows this many; the rest are behind "See all alerts". */
export const ATTENTION_SHOWN = 5;
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
  /** The event's own facts (a reset time, an asset, a cap): what "cleared" and "(old limit)" are read from. */
  payload?: unknown;
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
  /** Charged since 00:00 UTC (`utcDayBounds`), the day the rows call "Today". */
  todayCharged: Money | null;
  /** Owed today (buyer debt not collected), shown beside the charged figure. */
  todayOwed: Money | null;
  /** The calls behind `todayCharged` (owed, not charged and in-progress calls left out). */
  todayCalls: number;
  /** Today's calls owed as buyer debt, counted apart from `todayCalls`. */
  todayOwedCalls: number;
  yesterdayCharged: Money | null;
  chart: ChartDay[];
  /** Tool ids seen in the 7-day window, most-spent first. */
  chartTools: string[];
  recentCalls: ToolCall[];
  /** Unread alerts, newest first: as many pages as Needs attention needed (see `readAttention`). */
  notifications: NotificationRow[];
  /** The unread list was read to its end. When false, more unread alerts may exist. */
  notificationsComplete: boolean;
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

/** Unread alerts per page, and the most pages one load reads. */
const ATTENTION_PAGE = 50;
const ATTENTION_PAGES = 5;

/**
 * Reads unread alerts page by page until Needs attention has its rows or the
 * list ends. Cleared alerts stay unread (hiding is display only), so they can
 * pile up above an open one; reading only the newest page would then say
 * "Nothing needs your attention" while something does. The balances come
 * from their own request, so "cleared" is judged here with balances unknown —
 * never hiding more than the page will.
 */
async function readAttention(anchor: Date): Promise<{ items: NotificationRow[]; complete: boolean }> {
  const items: NotificationRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < ATTENTION_PAGES; page += 1) {
    const result = (await listNotifications({ limit: ATTENTION_PAGE, unreadOnly: true, cursor })) as CursorPage<NotificationRow>;
    items.push(...(result.items ?? []));
    cursor = result.pageInfo?.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
    if (!cursor) return { items, complete: true };
    const open = attentionRows(items, {
      now: anchor.getTime(),
      balances: null,
      dismissed: new Set(),
      complete: false,
      shown: ATTENTION_SHOWN,
    });
    if (open.shown.length >= ATTENTION_SHOWN) break;
  }
  return { items, complete: false };
}

/** `assetKey`: the display-asset pick; a change refetches without a reload. */
export function useOverview(anchor: Date, assetKey: string | null = null): OverviewState {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const month = useMemo(() => monthPeriod(anchor), [anchor]);
  const days = useMemo(() => recentDays(anchor, 7), [anchor]);
  // The UTC day, the boundary the Recent calls rows' "Today" / "Yesterday"
  // labels use and the backend groups by, so "Spent today" counts exactly the
  // rows labelled today (review 2026-10-17 P3).
  const today = useMemo(() => utcDayBounds(anchor), [anchor]);
  const yesterday = useMemo(() => utcDayBounds(anchor, { offsetDays: -1 }), [anchor]);

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
      // Needs attention: unread only, so a dismissed (read) alert stays gone.
      readAttention(anchor),
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
          // The count matches the amount: charged calls only; an owed call is named apart.
          todayCalls: chargedCallsFromTotals(todayGroup),
          todayOwedCalls: todayGroup?.owedCalls ?? 0,
          yesterdayCharged: chargedFromTotals(yesterdaySummary.totals),
          chart: chart.chart,
          chartTools: chart.tools,
          recentCalls: calls.items ?? [],
          notifications: notes.items,
          notificationsComplete: notes.complete,
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
  }, [anchor, month, days, today, yesterday, nonce, assetKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
