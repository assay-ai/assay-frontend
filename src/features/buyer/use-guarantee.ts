"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CursorPage, Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getWithheld, getReceiptsSummary, listToolCalls, type ToolCall } from "@/services";
import { listVerdicts, type VerdictRow } from "@/services/guarantee.service";
import { plain } from "@/libs/plain-language";
import { notCharged, toDecimal } from "@/utils/money";

import { bucketOfStatus } from "./not-charged";
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
  /** A stable key: the verdict's `reasonCode` for a failed check, else the class. */
  reason: string;
  /**
   * The `GET /withheld` bucket the calls are counted in (from their status), so
   * the reasons nest under the same three lines as the totals: "Failed our
   * checks (incl. wrong format)" is one count everywhere.
   */
  bucket: string;
  /** The plain sentence a buyer reads. */
  label: string;
  calls: number;
  amount: Money | null;
  /** The tool most of these calls went to, and the provider that served it. */
  mostlyToolId: string | null;
  mostlyProviderId: string | null;
}

/**
 * One month, in `GET /receipts/summary`'s buckets, so the row adds up the way
 * /spend does: listed = charged + not charged + owed + in progress.
 */
export interface MonthRow {
  period: Period;
  calls: number;
  listed: Money | null;
  charged: Money | null;
  /** Everything not charged and not owed. The guarantee's withheld is a part of it. */
  notCharged: Money | null;
  /** Buyer debt, open or written off: served, payment not collected yet. */
  owed: Money | null;
  inProgress: Money | null;
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
  /** The summary's not charged: equals the withheld total, so the bar adds up to listed. */
  notCharged: Money | null;
  /** Calls not finished yet, at their listed price. */
  inProgress: Money | null;
  /** Buyer debt, open or written off: neither charged nor withheld. */
  owed: Money | null;
  /** How many calls `owed` is for. */
  owedCalls: number;
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

/** The statuses that end a call without a charge (see the backend's `withheld` buckets). */
const NOT_CHARGED_STATUSES = new Set(["REFUNDED", "VOIDED", "EXPIRED"]);

/**
 * A served call that was never collected and is not owed: the provider
 * forfeited it, or its debt was voided. A legacy platform absorb is not
 * visible on a call row (it reads as charged), so the Not collected line's
 * figure comes from `GET /withheld`, never from this fold.
 */
function notCollected(call: ToolCall): boolean {
  return call.status === "SETTLED" && (call.forfeited === true || call.debt === "VOIDED");
}

/**
 * Why each not-charged call was not charged, for EVERY such call — not only the
 * ones with a verdict. Grouped by the call's real reason, the same classes the
 * receipt tells (`notChargedReason` in features/g30/receipt-state):
 *  - REFUNDED with a FAIL verdict: failed our checks, split by the verdict's reason;
 *  - REFUNDED with no verdict: the result was in the wrong format;
 *  - a MISAPPLIED verdict: outside what the tool covers;
 *  - VOIDED: no usable result (provider error, rejected request or no answer);
 *  - EXPIRED: did not finish in time;
 *  - SETTLED, forfeited or debt voided: not collected.
 * Each row also carries its bucket, so the screen nests reasons under the
 * same lines as the totals.
 */
export function foldReasons(verdicts: VerdictRow[], calls: ToolCall[]): FailureReason[] {
  const reasonByIntent = new Map(verdicts.map((v) => [v.intentId, v.reasonCode]));
  const byReason = new Map<
    string,
    {
      reason: string;
      bucket: string;
      label: string;
      calls: number;
      amounts: Money[];
      tools: Map<string, number>;
      providers: Map<string, number>;
    }
  >();

  for (const call of calls) {
    if (!(NOT_CHARGED_STATUSES.has(call.status) || notCollected(call)) || !toDecimal(call.charged).isZero()) continue;
    if (toDecimal(call.price).isZero()) continue; // free-tier calls are counted separately
    const bucket = bucketOfStatus(call.status) ?? "PROVIDER_OR_PLATFORM_ERROR";
    const { key: reason, label } = reasonOf(call, reasonByIntent.get(call.intentId) ?? null);
    // Keyed by bucket too: a late FAIL that voided a debt is not collected, not a refund.
    const key = `${bucket}|${reason}`;

    let entry = byReason.get(key);
    if (!entry) {
      entry = { reason, bucket, label, calls: 0, amounts: [], tools: new Map(), providers: new Map() };
      byReason.set(key, entry);
    }
    entry.calls += 1;
    entry.tools.set(call.toolId, (entry.tools.get(call.toolId) ?? 0) + 1);
    if (call.providerId) {
      entry.providers.set(call.providerId, (entry.providers.get(call.providerId) ?? 0) + 1);
    }
    entry.amounts.push(notCharged(call.price, call.charged));
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

  return [...byReason.values()]
    .map((entry) => ({
      reason: entry.reason,
      bucket: entry.bucket,
      label: entry.label,
      calls: entry.calls,
      amount: sumMoney(entry.amounts, null),
      mostlyToolId: dominant(entry.tools),
      mostlyProviderId: dominant(entry.providers),
    }))
    .sort((a, b) => b.calls - a.calls);
}

function reasonOf(call: ToolCall, reasonCode: string | null): { key: string; label: string } {
  if (call.status === "SETTLED") {
    return call.forfeited
      ? { key: "FORFEITED", label: "The provider forfeited the payment" }
      : { key: "DEBT_VOIDED", label: "The payment was cancelled after a late check result" };
  }
  if (call.verdict === "FAIL") {
    if (!reasonCode || /^quorum_/i.test(reasonCode)) {
      return { key: "FAILED_CHECKS", label: "Failed our checks" };
    }
    return { key: `FAIL:${reasonCode}`, label: `Failed our checks: ${lowerFirst(plain(reasonCode))}` };
  }
  if (call.verdict === "MISAPPLIED") {
    return { key: "MISAPPLIED", label: "Outside what the tool covers" };
  }
  if (call.status === "REFUNDED") {
    return { key: "WRONG_FORMAT", label: "Result in the wrong format" };
  }
  if (call.status === "EXPIRED") {
    return { key: "EXPIRED", label: "Did not finish in time" };
  }
  return { key: "NO_USABLE_RESULT", label: "No usable result: the provider errored, rejected the request or never answered" };
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
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

  const totals = summary.totals;

  // The API's own buckets, never listed − charged: that gap also holds owed
  // and in-progress calls, which were neither charged nor let off.
  return {
    period,
    calls: totals?.calls ?? 0,
    listed: totals?.listedTotal ?? null,
    charged: totals?.chargedTotal ?? null,
    notCharged: totals?.notChargedTotal ?? null,
    owed: totals?.owedTotal ?? null,
    inProgress: totals?.inProgressTotal ?? null,
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
          notCharged: summary?.totals?.notChargedTotal ?? null,
          inProgress: summary?.totals?.inProgressTotal ?? null,
          owed: summary?.totals?.owedTotal ?? null,
          owedCalls: summary?.totals?.owedCalls ?? 0,
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
