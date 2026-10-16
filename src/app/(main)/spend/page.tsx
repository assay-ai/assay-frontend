"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CallsInFlight } from "@/components/buyer/calls-in-flight";
import { Sparkline } from "@/components/buyer/sparkline";
import { DisplayAssetSelect, displayAssetLabel, useDisplayAssetPick } from "@/components/display-asset-select";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { PageHeader } from "@/components/g31/chrome";
import {
  DEFAULT_WINDOW_ID,
  SPEND_DIMENSIONS,
  SPEND_WINDOWS,
  dimensionById,
  summaryGroupBy,
  windowById,
  windowRange,
} from "@/features/g30/period";
import { reconcileSentence } from "@/features/g30/spend-buckets";
import { changePercent, previousTotal, rankRows, spendCsv, spendCsvFilename, type RankedRow } from "@/features/g30/spend-view";
import type { ReceiptsSummary } from "@/features/g30/wire";
import { useChains } from "@/hooks/useChains";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getReceiptsSummary } from "@/services";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * Activity › Spend — "what did I spend, on what, and did it change?"
 *
 * One headline (spent · not charged · change vs the previous window, with a
 * daily sparkline), then a ranked bar list by tool, agent or provider, with
 * names everywhere. Free-only rows are drawn grey. Verdict and status are Calls
 * filters, not groupings. Every figure comes from `GET /receipts/summary`,
 * grouped and compared server-side.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function rowHref(dimension: string, key: string): string | null {
  if (dimension === "tool") return routes.calls({ tool: key });
  if (dimension === "provider") return routes.exploreProvider(key);
  return null;
}

function BarRow({ row, href }: { row: RankedRow; href: string | null }) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-label-sm text-01">{row.label}</span>
          <span className="shrink-0 font-mono text-mono-13 font-semibold text-01">{row.free ? "Free" : row.charged}</span>
        </div>
        <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-03">
          {row.free ? (
            <span className="h-full w-[6%] min-w-[6px] rounded-full bg-chart-6" />
          ) : (
            <>
              <span className="h-full bg-primary-500" style={{ width: `${row.chargedPct}%` }} />
              {row.notChargedPct > 0 ? (
                <span className="h-full bg-teal-500" style={{ width: `${Math.max(row.notChargedPct, 1)}%` }} />
              ) : null}
              {row.owedPct > 0 ? (
                <span className="h-full bg-warning-500" style={{ width: `${Math.max(row.owedPct, 1)}%` }} />
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-body-xs text-03">
          <span>{plural(row.calls, "call")}</span>
          {row.free ? <span>free calls only</span> : null}
          {row.notCharged ? <span className="text-teal-600">{row.notCharged} not charged</span> : null}
          {row.owed ? <span className="text-warning-700">{row.owed} owed, not collected yet</span> : null}
          {row.delta ? <span>{row.delta} vs before</span> : null}
        </div>
      </div>
      {href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" /> : null}
    </>
  );
  return (
    <li className="border-b border-01 last:border-b-0">
      {href ? (
        <Link
          href={href}
          className="flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
        >
          {body}
        </Link>
      ) : (
        <div className="flex w-full items-center gap-3 px-4 py-3.5 tablet:px-5">{body}</div>
      )}
    </li>
  );
}

export default function SpendPage() {
  const [windowId, setWindowId] = React.useState(DEFAULT_WINDOW_ID);
  const [dimensionId, setDimensionId] = React.useState("tool");
  const assetPick = useDisplayAssetPick();
  const names = useEntityNames();
  const { chains } = useChains();

  const win = windowById(windowId);
  const dimension = dimensionById(dimensionId);
  const range = React.useMemo(() => windowRange(win), [win]);

  const query = useQuery<ReceiptsSummary, ApiError>({
    queryKey: ["receipts-summary", dimension.id, range.from, range.to, assetPick],
    queryFn: () =>
      getReceiptsSummary({
        from: range.from,
        to: range.to,
        groupBy: summaryGroupBy(dimension.id),
        compareTo: "previous_period",
      } as Record<string, string>) as Promise<ReceiptsSummary>,
    retry: 0,
    networkMode: "always" as const,
  });

  // The sparkline: charged per day across the window (not drawn for 24 hours).
  const daily = useQuery<ReceiptsSummary, ApiError>({
    queryKey: ["receipts-summary", "day", range.from, range.to, assetPick],
    enabled: win.hours >= 72,
    queryFn: () =>
      getReceiptsSummary({ from: range.from, to: range.to, groupBy: "day" } as Record<string, string>) as Promise<ReceiptsSummary>,
    retry: 0,
  });

  const summary = query.data;
  const labelOf = React.useCallback(
    (key: string) => {
      if (dimension.id === "tool") return names.name("tool", key);
      if (dimension.id === "provider") return names.name("provider", key);
      const agentId = key.replace(/^agent:/, "");
      return names.lookup("credential", key) ?? names.lookup("agent", agentId) ?? names.name("agent", agentId);
    },
    [dimension.id, names],
  );

  const rows = React.useMemo(() => rankRows(summary?.groups ?? [], labelOf), [summary, labelOf]);
  const previous = React.useMemo(() => previousTotal(summary?.groups ?? []), [summary]);
  const change = summary ? changePercent(summary.totals.chargedTotal, previous) : null;
  const freeCalls = rows.filter((r) => r.free).reduce((n, r) => n + r.calls, 0);
  const sparkValues = React.useMemo(
    () =>
      [...(daily.data?.groups ?? [])]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => toDecimal(g.chargedTotal).toNumber()),
    [daily.data],
  );

  const exportCsv = React.useCallback(() => {
    if (!summary) return;
    const csv = spendCsv(summary.groups, {
      dimensionHeader: dimension.header,
      labelOf,
      assetLabel: summary.asset ? displayAssetLabel(summary.asset, chains) : "",
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = spendCsvFilename(dimension.id, range.from, range.to);
    link.click();
    URL.revokeObjectURL(url);
  }, [summary, dimension, labelOf, chains, range]);

  const isEmpty = Boolean(summary) && summary!.groups.length === 0;
  const hasOwed = Boolean(summary && (summary.totals.owedCalls ?? 0) > 0);

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Spend"
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!summary || isEmpty} icon={<Download aria-hidden="true" />}>
            Export CSV
          </Button>
        }
      />

      <div className="flex w-full flex-wrap items-center gap-3">
        <Segmented value={windowId} onValueChange={setWindowId} aria-label="Period" className="inline-flex rounded-md bg-03 p-0.5">
          {SPEND_WINDOWS.map((w) => (
            <SegmentedItem key={w.id} value={w.id}>
              {w.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <DisplayAssetSelect live />

      {query.isPending ? (
        <PageState kind="loading" rows={5} label="Loading your spend" />
      ) : query.error ? (
        <PageState
          kind="error"
          title="Your spend could not be loaded"
          description={plainError(query.error.code)}
          onRetry={() => void query.refetch()}
          code={query.error.code}
          details={query.error.message}
        />
      ) : isEmpty ? (
        <PageState
          kind="empty"
          title="No spend in this period"
          description="When your agent calls a paid tool, what it spent shows here. A call that fails our checks is not charged."
          action={{ label: "See all calls", href: routes.calls() }}
        />
      ) : summary ? (
        <>
          {/* The headline: the answer in one line, no clicks. */}
          <section className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 px-5 py-4 tablet:flex-row tablet:items-center tablet:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-mono-2xl font-semibold text-01">{formatMoney(summary.totals.chargedTotal)}</span>
                <span className="text-body-md text-02">spent</span>
                <span aria-hidden="true" className="text-03">·</span>
                <span className="font-mono text-mono-md font-semibold text-teal-600">
                  {formatMoney(summary.totals.notChargedTotal ?? summary.totals.withheldTotal)}
                </span>
                <span className="text-body-md text-02">
                  <Term k="not-charged">not charged</Term>
                </span>
                {hasOwed ? (
                  <>
                    <span aria-hidden="true" className="text-03">·</span>
                    <span className="font-mono text-mono-md font-semibold text-warning-700">{formatMoney(summary.totals.owedTotal)}</span>
                    <span className="text-body-md text-02">owed</span>
                  </>
                ) : null}
                {change ? (
                  <>
                    <span aria-hidden="true" className="text-03">·</span>
                    <span className={cn("text-body-md", change.startsWith("▲") ? "text-warning-600" : "text-02")}>
                      {change} vs {win.compareLabel}
                    </span>
                  </>
                ) : null}
              </p>
              <p className="text-body-13 text-03">
                {plural(summary.totals.calls, "call")} ·{" "}
                {plural(summary.totals.notChargedCalls ?? summary.totals.refundedCalls, "call")} not charged
                {hasOwed ? ` · ${plural(summary.totals.owedCalls, "call")} owed` : ""}
                {freeCalls > 0 ? ` · ${plural(freeCalls, "free call")}` : ""} · {win.label.toLowerCase()}
              </p>
              {/* How the figures add up: listed = charged + not charged + owed (+ in progress). */}
              <p className="text-body-xs text-03" data-testid="spend-reconcile">
                {reconcileSentence(summary.totals)}
              </p>
              {hasOwed ? (
                <p className="text-body-xs text-warning-700">
                  Owed is buyer debt: calls your agent made whose payment could not be collected yet. Paid calls stay paused
                  until it is settled from the banner at the top.
                </p>
              ) : null}
            </div>
            <Sparkline
              values={sparkValues}
              label={`Spend per day over the ${win.label.toLowerCase()}`}
              className="text-primary-500"
              width={160}
              height={40}
            />
          </section>

          <section className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01">
            <div className="flex flex-col gap-3 border-b border-01 px-4 py-3.5 tablet:flex-row tablet:items-center tablet:justify-between tablet:px-5">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-label-md text-01">Where it went</h2>
                <p className="flex flex-wrap items-center gap-3 text-body-xs text-03">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-sm bg-primary-500" /> Charged
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-sm bg-teal-500" /> Not charged
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-sm bg-chart-6" /> Free
                  </span>
                </p>
              </div>
              <Segmented value={dimensionId} onValueChange={setDimensionId} aria-label="Group by" className="inline-flex self-start rounded-md bg-03 p-0.5">
                {SPEND_DIMENSIONS.map((d) => (
                  <SegmentedItem key={d.id} value={d.id}>
                    By {d.label.toLowerCase()}
                  </SegmentedItem>
                ))}
              </Segmented>
            </div>
            <ul className="flex flex-col">
              {rows.map((row) => (
                <BarRow key={row.key} row={row} href={rowHref(dimension.id, row.key)} />
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <CallsInFlight />
    </div>
  );
}
