"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getWithheld, getReceiptsSummary, listToolCalls, type ToolCall } from "@/services";
import { listVerdicts, type VerdictRow } from "@/services/guarantee.service";
import { notCharged, toDecimal } from "@/utils/money";

import { monthPeriod, recentMonths, sumMoney, type Period } from "./period";
import { readWithheld, type SummaryWire, type WithheldForAsset } from "./wire";

/**
 * Everything the Guarantee screen renders, assembled from four endpoints.
 *
 * The screen's whole claim is that the figure is *checkable*, so nothing here
 * is derived where the API states it: the hero amount is `GET /withheld`'s own
 * total, the billed/listed pair is `GET /receipts/summary`'s own totals, and
 * the ledger reconciliation is the API's `ok` flag rather than a comparison
 * this file performs. Only the "Why calls failed" table is folded client-side,
 * because no endpoint aggregates by reason.
 */

/** How many pages of a cursor list a fold will walk before giving up. */
// `limit` is capped at 100 by the API (`limit must not be greater than 100`),
// so the 1,000-call ceiling the screen states is 10 pages, not 5.
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) {
      return { items, complete: true };
    }
    cursor = result.pageInfo.nextCursor;
  }

  // Walked the cap and there is still more. The caller says so on screen
  // rather than presenting a partial fold as a total.
  return { items, complete: false };
}

export interface FailureReason {
  /** The API's own `reasonCode`. Not a verdict — see rule 3. */
  reason: string;
  calls: number;
  amount: Money | null;
  /** The tool most of these calls went to, and the provider that served it. */
  mostlyToolId: string | null;
  mostlyProviderId: string | null;
}

export interface MonthRow {
  period: Period;
  calls: number;
  listed: Money | null;
  charged: Money | null;
  notCharged: Money | null;
}

export interface FreeTier {
  calls: number;
  listed: Money | null;
}

export interface GuaranteeData {
  period: Period;
  /** Null when the account has never had a withheld figure for this asset. */
  withheld: WithheldForAsset | null;
  /**
   * Set when `GET /withheld` itself failed. The hero figure is the ledger's own
   * number and nothing else may stand in for it, so the screen says the figure
   * is unavailable rather than quietly substituting the summary endpoint's.
   */
  withheldError: ApiError | null;
  listed: Money | null;
  charged: Money | null;
  totalCalls: number;
  reasons: FailureReason[];
  /** False when the reason fold hit the page cap; the screen must say so. */
  reasonsComplete: boolean;
  months: MonthRow[];
  freeTier: FreeTier | null;
}

export interface GuaranteeState {
  data: GuaranteeData | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  /** Selectable windows, newest first — the month picker in the page header. */
  months: Period[];
  period: Period;
  onSelectMonth: (key: string) => void;
}

function foldReasons(verdicts: VerdictRow[], calls: ToolCall[]): FailureReason[] {
  const callById = new Map(calls.map((c) => [c.intentId, c]));
  const byReason = new Map<
    string,
    { calls: number; amounts: Money[]; tools: Map<string, number>; providers: Map<string, number> }
  >();

  for (const verdict of verdicts) {
    const reason = verdict.reasonCode;
    if (!reason) continue;

    let entry = byReason.get(reason);
    if (!entry) {
      entry = { calls: 0, amounts: [], tools: new Map(), providers: new Map() };
      byReason.set(reason, entry);
    }
    entry.calls += 1;
    entry.tools.set(verdict.toolId, (entry.tools.get(verdict.toolId) ?? 0) + 1);
    if (verdict.providerId) {
      entry.providers.set(verdict.providerId, (entry.providers.get(verdict.providerId) ?? 0) + 1);
    }

    const call = callById.get(verdict.intentId);
    if (call) entry.amounts.push(notCharged(call.price, call.charged));
  }

  const dominant = (counts: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best;
  };

  return [...byReason.entries()]
    .map(([reason, entry]) => ({
      reason,
      calls: entry.calls,
      amount: sumMoney(entry.amounts, null),
      mostlyToolId: dominant(entry.tools),
      mostlyProviderId: dominant(entry.providers),
    }))
    .sort((a, b) => b.calls - a.calls);
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError("UNKNOWN", "The guarantee figures could not be loaded", 0);
}

async function loadMonth(period: Period): Promise<MonthRow> {
  const summary = (await getReceiptsSummary({
    from: period.from,
    to: period.to,
    groupBy: "day",
  })) as SummaryWire;

  const listed = summary.totals?.listedTotal ?? null;
  const charged = summary.totals?.chargedTotal ?? null;

  return {
    period,
    calls: summary.totals?.calls ?? 0,
    listed,
    charged,
    // `withheldTotal` is the API's own figure for the window; falling back to
    // listed − charged would quietly disagree with `GET /withheld`.
    notCharged: summary.totals?.withheldTotal ?? null,
  };
}

/** `assetKey`: the display-asset pick; a change refetches without a reload. */
export function useGuarantee(anchor: Date, monthsBack = 3, assetKey: string | null = null): GuaranteeState {
  const [selectedKey, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<GuaranteeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const months = useMemo(() => recentMonths(anchor, monthsBack), [anchor, monthsBack]);
  const period = useMemo(
    () => months.find((m) => m.key === selectedKey) ?? monthPeriod(anchor),
    [months, selectedKey, anchor],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const window = { from: period.from, to: period.to };

    // allSettled, not all: this screen is the product's argument for itself, so
    // one endpoint failing must cost that one section, not the page. In
    // particular `GET /withheld` is currently rejecting every windowed request
    // (CHAIN_ASSET_UNKNOWN) on the running API — losing the trend table and the
    // failure reasons to that would be gratuitous.
    Promise.allSettled([
      getWithheld(window),
      getReceiptsSummary({ ...window, groupBy: "day" }) as Promise<SummaryWire>,
      collectPages<VerdictRow>((cursor) =>
        listVerdicts({
          ...window,
          cursor,
          limit: PAGE_SIZE,
          verdictStatus: ["FAIL", "MISAPPLIED"],
        }),
      ),
      collectPages<ToolCall>((cursor) => listToolCalls({ ...window, cursor, limit: PAGE_SIZE })),
      Promise.all(months.map(loadMonth)),
    ])
      .then(([withheldR, summaryR, verdictR, callR, monthR]) => {
        if (cancelled) return;

        const summary = summaryR.status === "fulfilled" ? summaryR.value : null;
        const verdicts = verdictR.status === "fulfilled" ? verdictR.value : { items: [], complete: true };
        const calls = callR.status === "fulfilled" ? callR.value : { items: [], complete: true };
        const monthRows = monthR.status === "fulfilled" ? monthR.value : [];
        const freeCalls = calls.items.filter((c) => toDecimal(c.price).isZero());

        setData({
          period,
          withheld:
            withheldR.status === "fulfilled" ? readWithheld(withheldR.value, summary?.asset) : null,
          withheldError: withheldR.status === "rejected" ? asApiError(withheldR.reason) : null,
          listed: summary?.totals?.listedTotal ?? null,
          charged: summary?.totals?.chargedTotal ?? null,
          totalCalls: summary?.totals?.calls ?? 0,
          reasons: foldReasons(verdicts.items, calls.items),
          reasonsComplete: verdicts.complete && calls.complete,
          months: monthRows,
          freeTier:
            freeCalls.length > 0
              ? { calls: freeCalls.length, listed: sumMoney(freeCalls.map((c) => c.price), null) }
              : null,
        });
        // Only a total failure is the page's error; a partial one is a section's.
        setError(
          summaryR.status === "rejected" && withheldR.status === "rejected"
            ? asApiError(summaryR.reason)
            : null,
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(asApiError(cause));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, months, nonce, assetKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const onSelectMonth = useCallback((key: string) => setSelected(key), []);

  return { data, loading, error, reload, months, period, onSelectMonth };
}
