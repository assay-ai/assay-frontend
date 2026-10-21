"use client";

import { chargedCallsFromTotals, chargedFromTotals, owedFromTotals } from "@/features/g30/spend-buckets";
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listNotifications, type AccountBalance, type ToolCall } from "@/services";
import { getOverview, type OverviewResponse } from "@/services/dashboard.service";
import { pickDisplayAsset, resolveDisplayAsset, storedDisplayAsset } from "@/services/display-asset";
import { toDecimal } from "@/utils/money";

import { attentionRows } from "./alert-model";
import { monthPeriod, type Period } from "./period";
import { readWithheld, type HoldRow, type SummaryWire, type WithheldForAsset } from "./wire";

/** Needs attention shows this many; the rest are behind "See all alerts". */
export const ATTENTION_SHOWN = 5;

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
  /** How many unread pages this load read: the next refresh reads no more than that. */
  attentionPages: number;
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

/** Every Overview query; a write that changes what the screen shows invalidates this. */
export const OVERVIEW_KEY = ["overview"] as const;

/** How often the figures refresh: the header promises "Updates every 30 seconds". */
export const OVERVIEW_REFRESH_MS = 30_000;

/**
 * Bar heights are the one place a money amount becomes a float. Nothing
 * rendered as text comes from this: every figure on the screen still goes
 * through `formatMoney` on the original `Money`. A chart column is pixels, and
 * pixels are not exact anyway.
 */
function toChartNumber(money: Money | undefined | null): number {
  return money ? toDecimal(money).toNumber() : 0;
}

/** The 7-day day-by-tool stack, from `GET /overview`'s `chart` (one summary per UTC day). */
export function chartFrom(chart: OverviewResponse["chart"]): { chart: ChartDay[]; tools: string[] } {
  const totals = new Map<string, number>();
  const days = (chart.days ?? []).map((day) => {
    const byTool: Record<string, number> = {};
    for (const group of (day.summary as SummaryWire).groups ?? []) {
      const value = toChartNumber(group.chargedTotal);
      byTool[group.key] = value;
      totals.set(group.key, (totals.get(group.key) ?? 0) + value);
    }
    return { key: day.key, byTool };
  });

  // A free-only tool charged nothing: no legend entry without a bar (fe-followup M4).
  const tools = [...totals.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  return { chart: days, tools };
}

/** Unread alerts per page, and the most pages one load reads. */
const ATTENTION_PAGE = 50;
const ATTENTION_PAGES = 5;
/** Recent calls shows this many. */
const RECENT_CALLS = 6;

/**
 * Reads unread alerts page by page until Needs attention has its rows or the
 * list ends, starting from the first page `GET /overview` already answered.
 * Cleared alerts stay unread (hiding is display only), so they can pile up
 * above an open one; reading only the newest page would then say "Nothing
 * needs your attention" while something does. "Cleared" is judged here with
 * balances unknown — never hiding more than the page will.
 */
async function readAttention(
  anchor: Date,
  maxPages: number,
  first: CursorPage<NotificationRow>,
): Promise<{ items: NotificationRow[]; complete: boolean; pages: number }> {
  const items: NotificationRow[] = [];
  let page = first;
  let pages = 1;
  for (;;) {
    items.push(...(page.items ?? []));
    const cursor = page.pageInfo?.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    if (!cursor) return { items, complete: true, pages };
    const open = attentionRows(items, {
      now: anchor.getTime(),
      balances: null,
      dismissed: new Set(),
      complete: false,
      shown: ATTENTION_SHOWN,
    });
    if (open.shown.length >= ATTENTION_SHOWN || pages >= maxPages) break;
    page = (await listNotifications({ limit: ATTENTION_PAGE, unreadOnly: true, cursor })) as CursorPage<NotificationRow>;
    pages += 1;
  }
  return { items, complete: false, pages };
}

/** The assets these balances are in, in their order, without duplicates. */
function assetsOf(balances: readonly AccountBalance[]): string[] {
  return [...new Set(balances.map((row) => row.asset))];
}

/**
 * The newest Overview answer in the cache, if any. Read from the cache, not
 * kept beside it, so the identity reset (`resetQueries`) forgets it with the
 * rest, and a load that was cancelled or overtaken never writes it.
 */
function latestOverview(queryClient: QueryClient): OverviewData | undefined {
  const latest = queryClient
    .getQueryCache()
    .findAll({ queryKey: OVERVIEW_KEY })
    .filter((query) => query.state.data !== undefined)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
  return latest?.state.data as OverviewData | undefined;
}

/**
 * One `GET /overview`, then the further unread pages Needs attention needs.
 *
 * `?asset=` is the pick `getReceiptsSummary` makes (`resolveDisplayAsset`),
 * sent only for a buyer who holds more than one asset. After the first load
 * the balances come with the overview itself (`known`), so a refresh does not
 * read `GET /balances` again just to decide it.
 */
async function loadOverview(
  anchor: Date,
  maxAttentionPages: number,
  known: readonly AccountBalance[] | undefined,
): Promise<{ wire: OverviewResponse; notes: { items: NotificationRow[]; complete: boolean; pages: number } }> {
  const ask = (asset: string | undefined) =>
    getOverview({
      at: anchor.toISOString(),
      ...(asset ? { asset } : {}),
      callsLimit: RECENT_CALLS,
      alertsLimit: ATTENTION_PAGE,
    });
  let wire: OverviewResponse;
  if (known) {
    try {
      wire = await ask(pickDisplayAsset(assetsOf(known), storedDisplayAsset()));
    } catch (error) {
      // A second asset arrived since the last refresh: decide again from a fresh read.
      if (!(error instanceof ApiError) || error.code !== "VERIFICATION_SUMMARY_MULTIPLE_ASSETS") throw error;
      wire = await ask(await resolveDisplayAsset());
    }
  } else {
    wire = await ask(await resolveDisplayAsset());
  }
  const notes = await readAttention(anchor, maxAttentionPages, wire.notifications as CursorPage<NotificationRow>);
  return { wire, notes };
}

function toOverviewData(month: Period, wire: OverviewResponse, notes: Awaited<ReturnType<typeof loadOverview>>["notes"]): OverviewData {
  const monthSummary = wire.monthSummary as SummaryWire;
  const todayGroup = (wire.todaySummary as SummaryWire).totals;
  const chart = chartFrom(wire.chart);
  return {
    month,
    balances: wire.balances.balances ?? [],
    holds: (wire.holds as CursorPage<HoldRow>).items ?? [],
    withheld: readWithheld(wire.withheld, monthSummary.asset),
    monthListed: monthSummary.totals?.listedTotal ?? null,
    attentionPages: Math.max(1, notes.pages),
    // "Spent" is charged only (one meaning on every screen); owed sits beside it.
    todayCharged: chargedFromTotals(todayGroup),
    todayOwed: owedFromTotals(todayGroup),
    // The count matches the amount: charged calls only; an owed call is named apart.
    todayCalls: chargedCallsFromTotals(todayGroup),
    todayOwedCalls: todayGroup?.owedCalls ?? 0,
    yesterdayCharged: chargedFromTotals((wire.yesterdaySummary as SummaryWire).totals),
    chart: chart.chart,
    chartTools: chart.tools,
    recentCalls: wire.recentCalls.items ?? [],
    notifications: notes.items,
    notificationsComplete: notes.complete,
  };
}

/**
 * The Overview's figures: ONE `GET /overview` every 30 seconds (it used to be
 * 14–18 requests), plus a further unread page only when Needs attention is
 * not full yet. Any part failing fails the whole load, as the batch did.
 *
 * `assetKey`: the display-asset pick; a change refetches without a reload.
 */
export function useOverview(anchor: Date, assetKey: string | null = null): OverviewState {
  const queryClient = useQueryClient();
  const month = useMemo(() => monthPeriod(anchor), [anchor]);

  const query = useQuery<OverviewData, unknown>({
    queryKey: [...OVERVIEW_KEY, anchor.toISOString(), assetKey],
    queryFn: async () => {
      const previous = latestOverview(queryClient);
      // The first load reads up to ATTENTION_PAGES pages; each refresh reads
      // only as many as the last load needed, so a refresh is not five reads.
      const { wire, notes } = await loadOverview(anchor, previous?.attentionPages ?? ATTENTION_PAGES, previous?.balances);
      return toOverviewData(month, wire, notes);
    },
    refetchInterval: OVERVIEW_REFRESH_MS,
    // Back on the tab after a while (the interval pauses while it is hidden): fresh figures at once.
    staleTime: OVERVIEW_REFRESH_MS,
    refetchOnWindowFocus: true,
    // A new asset pick keeps the figures on screen until the new ones land.
    placeholderData: keepPreviousData,
    retry: 0,
  });

  const { refetch } = query;
  const reload = useCallback(() => void refetch(), [refetch]);
  // As before: a refresh clears the last error while it runs, and the figures stay.
  const error =
    query.isFetching || query.error == null
      ? null
      : query.error instanceof ApiError
        ? query.error
        : new ApiError("UNKNOWN", "The overview could not be loaded", 0);

  return { data: query.data ?? null, loading: query.isFetching, error, reload };
}
