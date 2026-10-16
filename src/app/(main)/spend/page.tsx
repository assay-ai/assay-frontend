"use client";

import { DisplayAssetSelect } from "@/components/display-asset-select";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { ChevronDown, Download, Info } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CardRow } from "@/components/ui/card-row";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Table, type TableColumn } from "@/components/ui/table";
import {
  DEFAULT_WINDOW_ID,
  SPEND_DIMENSIONS,
  SPEND_WINDOWS,
  credentialGroupLabels,
  dimensionById,
  groupKeyLabel,
  summaryGroupBy,
  windowById,
  windowRange,
} from "@/features/g30/period";
import { uncollectedNotWithheld } from "@/features/buyer-debt/debt-copy";
import { callBuckets, reconcileSentence } from "@/features/g30/spend-buckets";
import { Chip, ErrorBlock, PageHeader, PendingBlock } from "@/features/g30/ui";
import type { ReceiptsSummary, SummaryGroup } from "@/features/g30/wire";
import { ApiError } from "@/libs/ApiClient";
import {
  getReceiptsSummary,
  listAgents,
  listCredentials,
  listToolCalls,
  type ToolCall,
} from "@/services";
import { cn } from "@/utils";
import { formatDecimal, formatMoney, toDecimal } from "@/utils/money";
import { routes } from "@/libs/routes";

/**
 * Spend explorer.
 *
 * The design is explicit that PERIOD COMPARISON is the main panel and never a
 * flat list: an agent generates far more rows than a person can read, so the
 * screen leads with what CHANGED between two windows and only then offers the
 * grouped table. "What changed" is therefore the first panel on the page and
 * the only one that is always expanded.
 *
 * Every figure comes from `GET /receipts/summary`, which does the grouping and
 * the comparison server-side — the sub-line ("aggregated server-side — every
 * total reconciles to the sum of its rows") is a promise this screen keeps by
 * never re-deriving a total the server already sent.
 */

const ARROW_UP = "▲";
const ARROW_DOWN = "▼";

/** A signed money delta, in the design's own "▲ +$35.88" / "▼ −$0.07" shape. */
function deltaMoney(amount: string, decimals: number, asset: string, places: number): string {
  const value = new Decimal(amount);
  if (value.isZero()) return "—";
  const sign = value.isNegative() ? ARROW_DOWN : ARROW_UP;
  const magnitude = formatMoney(
    { amount: value.abs().toFixed(0), asset, decimals },
    { decimals: places },
  );
  return `${sign} ${value.isNegative() ? "−" : "+"}${magnitude}`;
}

function deltaCount(value: number): string {
  if (value === 0) return "—";
  const sign = value < 0 ? ARROW_DOWN : ARROW_UP;
  return `${sign} ${value < 0 ? "−" : "+"}${Math.abs(value).toLocaleString("en-US")}`;
}

/**
 * listed ÷ calls, at the price precision the design shows ($0.0025).
 *
 * Through `formatDecimal`, like the sentence below that compares two of these.
 * This helper wrote `toFixed(4, Decimal.ROUND_DOWN)` and the narrative wrote a
 * bare `toFixed(4)` — decimal.js's default is ROUND_HALF_UP — so the same
 * per-call price could be printed twice on this one screen, half a
 * ten-thousandth apart, with the table and the sentence disagreeing about the
 * number they were both describing.
 */
function perCall(group: { chargedTotal: SummaryGroup["chargedTotal"]; calls: number }): string {
  if (!group.calls) return "—";
  return formatDecimal(toDecimal(group.chargedTotal).div(group.calls), { decimals: 4 });
}

function percent(rate: number | null): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

interface Row extends SummaryGroup {
  id: string;
  label: string;
  /** The design's drill, as deep as the wire goes: the recent receipts. */
  drill?: Row[];
  /** Set on a drill row so its label cell becomes a link to the receipt. */
  intentId?: string;
}

/** Only `tool` and `provider` can be drilled — they are the only filterable ids. */
const DRILLABLE = new Set(["tool", "provider"]);

/**
 * A single stand-in drill row. It exists so the group keeps its caret while its
 * receipts are still in flight — a caret that appears only after a fetch is a
 * control that moves under the pointer.
 */
function placeholderRow(key: string, label: string, money: SummaryGroup["chargedTotal"]): Row {
  const zero = { amount: "0", asset: money.asset, decimals: money.decimals };
  return {
    id: `${key}:placeholder`,
    key,
    label,
    calls: 0,
    refundedCalls: 0,
    listedTotal: zero,
    chargedTotal: zero,
    withheldTotal: zero,
    notChargedTotal: zero,
    notChargedCalls: 0,
    owedTotal: zero,
    owedCalls: 0,
    inProgressTotal: zero,
    inProgressCalls: 0,
    failRate: null,
    comparison: null,
  };
}

/**
 * A tool-call becomes a drill row under its group. The design's drill is
 * "tool → provider → hour → 20 most recent receipts plus every failed call";
 * `GET /receipts/summary` takes no group filter, so the intermediate levels
 * cannot be fetched and the drill jumps straight to the receipts, which is the
 * level that lets a person leave this screen for the receipt screen.
 */
function callToRow(call: ToolCall): Row {
  // listed − charged is the withheld figure only for an ordinary call: a call
  // the provider forfeited, or whose debt was written off, was not charged but
  // nothing was withheld for it (the summary's `withheldTotal` leaves it out).
  const notWithheld = uncollectedNotWithheld(call);
  const buckets = callBuckets(call);
  const withheld = {
    amount: notWithheld || call.debt === "OUTSTANDING" ? "0" : buckets.notCharged.amount,
    asset: call.price.asset,
    decimals: call.price.decimals,
  };
  const isZero = (m: ToolCall["price"]) => m.amount === "0";
  return {
    id: call.intentId,
    intentId: call.intentId,
    key: call.intentId,
    label: `${call.intentId.slice(0, 8)}…`,
    calls: 1,
    refundedCalls: call.status === "REFUNDED" ? 1 : 0,
    listedTotal: call.price,
    chargedTotal: buckets.charged,
    withheldTotal: withheld,
    notChargedTotal: buckets.notCharged,
    notChargedCalls: isZero(buckets.notCharged) ? 0 : 1,
    owedTotal: buckets.owed,
    owedCalls: isZero(buckets.owed) ? 0 : 1,
    inProgressTotal: buckets.inProgress,
    inProgressCalls: isZero(buckets.inProgress) ? 0 : 1,
    failRate: null,
    comparison: null,
  };
}

/**
 * The reading under the comparison table. The design writes one sentence —
 * "scrape_url is 97% of the increase. Per-call price is unchanged — this is
 * volume." — which is a TEMPLATE with computed numbers, not a fixed string. The
 * first half is reproduced exactly; the second half branches, and the
 * price-moved branch is our wording, not the design's.
 */
function changeReading(rows: Row[]): string | null {
  const withDelta = rows.filter((r) => r.comparison);
  if (withDelta.length === 0) return null;

  const total = withDelta.reduce(
    (sum, r) => sum.plus(toDecimal(r.comparison!.deltaChargedTotal).abs()),
    new Decimal(0),
  );
  if (total.isZero()) return null;

  const biggest = withDelta.reduce((best, r) =>
    toDecimal(r.comparison!.deltaChargedTotal)
      .abs()
      .gt(toDecimal(best.comparison!.deltaChargedTotal).abs())
      ? r
      : best,
  );

  const share = toDecimal(biggest.comparison!.deltaChargedTotal)
    .abs()
    .div(total)
    .mul(100)
    .toFixed(0);
  const direction = toDecimal(biggest.comparison!.deltaChargedTotal).isNegative()
    ? "decrease"
    : "increase";

  const nowEach = biggest.calls ? toDecimal(biggest.chargedTotal).div(biggest.calls) : null;
  const wasEach = biggest.comparison!.calls
    ? toDecimal(biggest.comparison!.chargedTotal).div(biggest.comparison!.calls)
    : null;

  // The row already carries its label, resolved once (an agent id to its name).
  const name = biggest.label;
  const head = `${name} is ${share}% of the ${direction}.`;

  if (nowEach && wasEach && nowEach.eq(wasEach)) {
    return `${head} Per-call price is unchanged — this is volume.`;
  }
  if (nowEach && wasEach) {
    return `${head} Per-call price moved from ${formatDecimal(wasEach, { decimals: 4 })} to ${formatDecimal(nowEach, { decimals: 4 })}, so this is not volume alone.`;
  }
  return `${head} There is nothing to compare the per-call price with.`;
}

function toCsv(rows: Row[], headers: string[], cells: (row: Row) => string[]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows.map(cells)].map((r) => r.map(escape).join(",")).join("\n");
}

export default function SpendPage() {
  const [windowId, setWindowId] = React.useState(DEFAULT_WINDOW_ID);
  const [dimensionId, setDimensionId] = React.useState("tool");
  const [expanded, setExpanded] = React.useState<string[]>([]);

  const win = windowById(windowId);
  const dimension = dimensionById(dimensionId);

  // Pinned once per window choice so a re-render does not slide the range.
  const range = React.useMemo(() => windowRange(win), [win]);

  const query = useQuery<ReceiptsSummary, ApiError>({
    queryKey: ["receipts-summary", dimension.id, range.from, range.to],
    queryFn: () =>
      getReceiptsSummary({
        from: range.from,
        to: range.to,
        groupBy: summaryGroupBy(dimension.id),
        compareTo: "previous_period",
      } as Record<string, string>) as Promise<ReceiptsSummary>,
    // One retry, not three. A money screen that cannot load must SAY so
    // quickly; three silent retries is thirty seconds of a spinner that
    // resolves to an error anyway.
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  const summary = query.data;

  // Agent group keys are credential ids (U02); name them from `GET /agents` and
  // each agent's credentials. Fetched only while grouping by agent.
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    enabled: dimension.id === "agent",
    retry: false,
    queryFn: () => listAgents({ limit: 50 }),
  });
  const agentIds = (agentsQuery.data?.items ?? []).map((agent) => agent.agentId);
  const credentialsQuery = useQuery({
    queryKey: ["spend-agent-credentials", agentIds],
    enabled: dimension.id === "agent" && agentIds.length > 0,
    retry: false,
    queryFn: async () => {
      const lists = await Promise.all(
        agentIds.map(
          (id) =>
            listCredentials(id, { limit: 50 }) as Promise<{
              items: { id: string; name?: string | null }[];
            }>,
        ),
      );
      return Object.fromEntries(agentIds.map((id, i) => [id, lists[i].items]));
    },
  });
  const agentLabels = React.useMemo(
    () =>
      credentialGroupLabels(
        (agentsQuery.data?.items ?? []).map((agent) => ({
          agentId: agent.agentId,
          label: agent.label ?? null,
        })),
        credentialsQuery.data ?? {},
      ),
    [agentsQuery.data, credentialsQuery.data],
  );

  const canDrill = DRILLABLE.has(dimension.id);

  // The receipts behind the expanded groups. One query per open group, so
  // collapsing does not throw the rows away and reopening is instant.
  const drillQuery = useQuery<Record<string, ToolCall[]>, ApiError>({
    queryKey: ["spend-drill", dimension.id, range.from, range.to, [...expanded].sort().join(",")],
    enabled: canDrill && expanded.length > 0,
    queryFn: async () => {
      const pages = await Promise.all(
        expanded.map((key) =>
          listToolCalls({
            limit: 20,
            from: range.from,
            to: range.to,
            ...(dimension.id === "tool" ? { toolId: key } : { providerId: key }),
          }).then((page) => [key, page.items] as const),
        ),
      );
      return Object.fromEntries(pages);
    },
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  React.useEffect(() => {
    setExpanded([]);
  }, [dimension.id, range.from]);

  const rows: Row[] = React.useMemo(
    () =>
      (summary?.groups ?? []).map((g) => {
        const calls = drillQuery.data?.[g.key];
        let drill: Row[] | undefined;
        if (canDrill) {
          if (!calls) {
            drill = [placeholderRow(g.key, "Loading receipts…", g.chargedTotal)];
          } else if (calls.length === 0) {
            drill = [placeholderRow(g.key, "No receipts in this window", g.chargedTotal)];
          } else {
            drill = calls.map(callToRow);
          }
        }
        return {
          ...g,
          id: g.key,
          label: groupKeyLabel(g.key, dimension.id, agentLabels),
          drill,
        };
      }),
    [summary, dimension.id, canDrill, drillQuery.data, agentLabels],
  );

  // The comparison table is not drillable — it answers "what moved", and a
  // caret that expands nothing is a control that lies. `drill` is stripped
  // rather than left on, because `Table` draws a caret for any row that has one.
  const changeRows = React.useMemo(
    () =>
      rows
        .map(({ drill: _drill, ...rest }) => rest as Row)
        .sort((a, b) =>
        toDecimal(b.comparison?.deltaChargedTotal ?? b.chargedTotal)
          .abs()
          .comparedTo(toDecimal(a.comparison?.deltaChargedTotal ?? a.chargedTotal).abs()),
      ),
    [rows],
  );

  const asset = summary?.asset ?? "";
  const decimals = summary?.totals.chargedTotal.decimals ?? 6;
  const reading = React.useMemo(() => changeReading(changeRows), [changeRows]);

  const changedTotal = summary?.totals.chargedTotal;
  const totalDelta = React.useMemo(() => {
    if (!summary) return null;
    return summary.groups.reduce(
      (sum, g) => sum.plus(new Decimal(g.comparison?.deltaChargedTotal.amount ?? "0")),
      new Decimal(0),
    );
  }, [summary]);

  /* --------------------------------------------------------------- columns */

  const changeColumns: TableColumn<Row>[] = [
    { key: "label", header: dimension.header, cell: (r) => r.label },
    {
      key: "charged",
      header: "Charged",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => formatMoney(r.chargedTotal),
    },
    {
      key: "deltaAmount",
      header: "Δ amount",
      width: 130,
      align: "end",
      mono: true,
      cell: (r) =>
        r.comparison
          ? deltaMoney(r.comparison.deltaChargedTotal.amount, decimals, asset, 2)
          : "—",
    },
    {
      key: "calls",
      header: "Calls",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => r.calls.toLocaleString("en-US"),
    },
    {
      key: "deltaCalls",
      header: "Δ calls",
      width: 120,
      align: "end",
      mono: true,
      cell: (r) => (r.comparison ? deltaCount(r.comparison.deltaCalls) : "—"),
    },
    {
      key: "perCall",
      header: "Per call",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => perCall(r),
    },
  ];

  const groupColumns: TableColumn<Row>[] = [
    {
      key: "label",
      header: dimension.header,
      cell: (r) =>
        r.intentId ? (
          <Link href={routes.receipt(r.intentId)} className="text-primary-500 hover:underline">
            {r.label}
          </Link>
        ) : (
          r.label
        ),
    },
    {
      key: "calls",
      header: "Calls",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => r.calls.toLocaleString("en-US"),
    },
    {
      key: "listed",
      header: "Listed",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => formatMoney(r.listedTotal),
    },
    {
      key: "charged",
      header: "Charged",
      width: 110,
      align: "end",
      mono: true,
      cell: (r) => formatMoney(r.chargedTotal),
    },
    {
      key: "notCharged",
      header: "Not charged",
      width: 130,
      align: "end",
      mono: true,
      notCharged: true,
      cell: (r) => formatMoney(r.notChargedTotal),
    },
    {
      // Served, payment not collected yet: neither charged nor let off.
      key: "owed",
      header: "Owed",
      width: 100,
      align: "end",
      mono: true,
      cell: (r) => formatMoney(r.owedTotal),
    },
    {
      key: "fail",
      header: "Fail",
      width: 90,
      align: "end",
      mono: true,
      cell: (r) => percent(r.failRate),
    },
    // The design's seventh column. `GET /receipts/summary` carries no latency,
    // so it renders "—" rather than an invented number.
    { key: "p95", header: "p95", width: 90, align: "end", mono: true, cell: () => "—" },
  ];

  const totals = summary
    ? {
        label: "Total",
        values: {
          calls: summary.totals.calls.toLocaleString("en-US"),
          listed: formatMoney(summary.totals.listedTotal),
          charged: formatMoney(summary.totals.chargedTotal),
          notCharged: formatMoney(summary.totals.notChargedTotal),
          owed: formatMoney(summary.totals.owedTotal),
          fail: percent(summary.totals.failRate),
          p95: "—",
        },
      }
    : undefined;

  /* ------------------------------------------------------------------ csv */

  const exportCsv = React.useCallback(() => {
    const csv = toCsv(
      rows,
      [dimension.header, "Calls", "Listed", "Charged", "Not charged", "Owed", "Fail rate", "Per call"],
      (r) => [
        r.key,
        String(r.calls),
        formatMoney(r.listedTotal, { grouped: false }),
        formatMoney(r.chargedTotal, { grouped: false }),
        formatMoney(r.notChargedTotal, { grouped: false }),
        formatMoney(r.owedTotal, { grouped: false }),
        percent(r.failRate),
        perCall(r),
      ],
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-${dimension.id}-${range.from.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [rows, dimension, range.from]);

  /* --------------------------------------------------------------- render */

  const isEmpty = Boolean(summary) && rows.length === 0;
  const hasOwed = Boolean(summary && summary.totals.owedCalls > 0);
  const reconcileLine = summary ? reconcileSentence(summary.totals) : "";

  return (
    <div className="flex w-full flex-col gap-[18px] bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Spend"
        sub="agent prod · aggregated server-side · every total reconciles to the sum of its rows"
        actions={
          // The mobile 390 frame carries no export affordance — that width is
          // for reading, and the desktop frame is where the CSV lives.
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="hidden tablet:inline-flex"
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      <div className="flex w-full flex-wrap items-center gap-2.5">
        <Chip label="Window">
          <span className="relative flex items-center gap-2">
            <select
              aria-label="Window"
              value={windowId}
              onChange={(e) => setWindowId(e.target.value)}
              className="appearance-none bg-transparent pr-4 font-mono text-mono-13 font-semibold text-01 outline-none"
            >
              {SPEND_WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-0 size-[13px] text-03"
            />
          </span>
        </Chip>
        <Chip label="Compare to">
          <span className="font-mono text-mono-13 font-semibold text-01">{win.compareLabel}</span>
        </Chip>
      </div>

      {query.isPending ? <PendingBlock label="Loading spend…" /> : null}
      <DisplayAssetSelect />
      {query.error ? <ErrorBlock code={query.error.code} message={query.error.message} /> : null}

      {summary && !isEmpty ? (
        <>
          {/* Mobile 390 puts the dimension control first, above the
              totals, and carries the comparison as one sentence rather than a
              table — a six-column table is unreadable at this width. */}
          <div className="flex w-full flex-wrap items-center gap-3 tablet:hidden">
            <Segmented value={dimensionId} onValueChange={setDimensionId}>
              {SPEND_DIMENSIONS.map((d) => (
                <SegmentedItem key={d.id} value={d.id} disabled={d.disabled} className="px-2 py-1.5">
                  {d.label}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>

          <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-[18px] tablet:hidden">
            <div className="flex w-full gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-body-13 text-03">Charged</span>
                <span className="font-mono text-mono-xl text-01">
                  {formatMoney(summary.totals.chargedTotal)}
                </span>
                <span className="font-mono text-mono-xs text-03">
                  {summary.totals.calls.toLocaleString("en-US")} calls
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-body-13 text-03">Not charged</span>
                <span className="font-mono text-mono-xl text-teal-600">
                  {formatMoney(summary.totals.notChargedTotal)}
                </span>
                <span className="font-mono text-mono-xs text-03">
                  {summary.totals.notChargedCalls.toLocaleString("en-US")} calls
                </span>
              </div>
              {hasOwed ? (
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="text-body-13 text-03">Owed</span>
                  <span className="font-mono text-mono-xl text-warning-600">
                    {formatMoney(summary.totals.owedTotal)}
                  </span>
                  <span className="font-mono text-mono-xs text-03">
                    {summary.totals.owedCalls.toLocaleString("en-US")} {summary.totals.owedCalls === 1 ? "call" : "calls"}
                  </span>
                </div>
              ) : null}
            </div>
            <p className="w-full text-body-13 text-03">{reconcileLine}</p>
            <p className="w-full text-body-13 text-02">
              {totalDelta ? deltaMoney(totalDelta.toFixed(0), decimals, asset, 2) : "—"} vs the{" "}
              {win.compareLabel}
              {reading ? ` — ${reading}` : ""}
            </p>
          </div>

          {/* Totals: charged and not charged are two figures, always both. */}
          <div className="hidden w-full flex-col gap-5 rounded-xl border border-01 bg-01 px-5 py-[18px] tablet:flex tablet:flex-row tablet:items-center tablet:gap-10">
            <div className="flex flex-1 flex-col gap-[3px]">
              <span className="text-body-13 text-03">Charged</span>
              <span className="font-mono text-mono-xl text-01">
                {formatMoney(summary.totals.chargedTotal)}
              </span>
              <span className="font-mono text-mono-12 text-03">
                {summary.totals.calls.toLocaleString("en-US")} calls
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-[3px]">
              <span className="text-body-13 text-03">Not charged</span>
              <span className="font-mono text-mono-xl text-teal-600">
                {formatMoney(summary.totals.notChargedTotal)}
              </span>
              <span className="font-mono text-mono-12 text-03">
                {summary.totals.notChargedCalls.toLocaleString("en-US")} calls
              </span>
            </div>
            {hasOwed ? (
              <div className="flex flex-1 flex-col gap-[3px]">
                <span className="text-body-13 text-03">Owed</span>
                <span className="font-mono text-mono-xl text-warning-600">
                  {formatMoney(summary.totals.owedTotal)}
                </span>
                <span className="font-mono text-mono-12 text-03">
                  {summary.totals.owedCalls.toLocaleString("en-US")} {summary.totals.owedCalls === 1 ? "call" : "calls"} · not collected yet
                </span>
              </div>
            ) : null}
            <div className="flex flex-1 flex-col gap-[3px]">
              <span className="text-body-13 text-03">Change</span>
              <span
                className={cn(
                  "font-mono text-mono-xl",
                  totalDelta && totalDelta.isNegative() ? "text-teal-600" : "text-warning-600",
                )}
              >
                {totalDelta && changedTotal
                  ? deltaMoney(totalDelta.toFixed(0), decimals, asset, 2)
                  : "—"}
              </span>
              <span className="font-mono text-mono-12 text-03">vs {win.compareLabel}</span>
            </div>
          </div>

          <p className="hidden w-full text-body-13 text-03 tablet:block">{reconcileLine}</p>

          {/* THE main panel. Comparison first, never a flat list. */}
          <Panel className="hidden tablet:flex">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>What changed</PanelTitle>
                <PanelDescription>
                  change in amount and calls per group, largest change first
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3 px-2.5 pb-3 pt-1.5">
              <div className="w-full overflow-x-auto">
                <div className="min-w-[760px]">
                  <Table columns={changeColumns} rows={changeRows} caption="What changed" />
                </div>
              </div>
              {reading ? <p className="px-3 text-body-sm text-01">{reading}</p> : null}
            </PanelBody>
          </Panel>

          <div className="hidden w-full flex-wrap items-center gap-3 tablet:flex">
            <span className="text-body-sm text-03">Group by</span>
            <Segmented value={dimensionId} onValueChange={setDimensionId}>
              {SPEND_DIMENSIONS.map((d) => (
                <SegmentedItem key={d.id} value={d.id} disabled={d.disabled}>
                  {d.label}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>

          {/* Desktop: the grouped table. */}
          <Panel className="hidden tablet:flex">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>By {dimension.label}</PanelTitle>
                <PanelDescription>
                  drill: tool → provider → hour → 20 most recent receipts plus every failed call
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-2.5 pb-2.5 pt-1.5">
              <div className="w-full overflow-x-auto">
                <div className="min-w-[960px]">
                  <Table
                    columns={groupColumns}
                    rows={rows}
                    total={totals}
                    expanded={expanded}
                    onToggleRow={
                      canDrill
                        ? (id) =>
                            setExpanded((open) =>
                              open.includes(id) ? open.filter((k) => k !== id) : [...open, id],
                            )
                        : undefined
                    }
                    caption={`By ${dimension.label}`}
                  />
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* Mobile 390: the row becomes a card. */}
          <div className="flex w-full flex-col gap-2.5 tablet:hidden">
            <p className="font-mono text-mono-2xs uppercase tracking-[1.2px] text-03">
              {`BY ${dimension.label.toUpperCase()} · ${rows.length} GROUPS`}
            </p>
            {rows.map((r) => (
              <div key={r.id} className="flex w-full flex-col gap-1.5">
                <CardRow
                  name={r.label}
                  callsLabel={`${r.calls.toLocaleString("en-US")} calls`}
                  figures={[
                    { label: "Listed", value: formatMoney(r.listedTotal) },
                    { label: "Charged", value: formatMoney(r.chargedTotal) },
                    { label: "Not charged", value: formatMoney(r.notChargedTotal), tone: "teal" },
                    ...(r.owedCalls > 0 ? [{ label: "Owed", value: formatMoney(r.owedTotal) }] : []),
                  ]}
                  meta={`fail ${percent(r.failRate)} · ${perCall(r)} each`}
                  onClick={
                    canDrill
                      ? () =>
                          setExpanded((open) =>
                            open.includes(r.id) ? open.filter((k) => k !== r.id) : [...open, r.id],
                          )
                      : undefined
                  }
                />
                {canDrill && expanded.includes(r.id)
                  ? (r.drill ?? []).map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-01 bg-02 px-4 py-2.5"
                      >
                        {sub.intentId ? (
                          <Link
                            href={routes.receipt(sub.intentId)}
                            className="font-mono text-mono-12 text-primary-500"
                          >
                            {sub.label}
                          </Link>
                        ) : (
                          <span className="font-mono text-mono-12 text-03">{sub.label}</span>
                        )}
                        <span className="font-mono text-mono-12 text-02">
                          {formatMoney(sub.chargedTotal, { decimals: 4 })}
                        </span>
                      </div>
                    ))
                  : null}
              </div>
            ))}
          </div>

          <Banner
            tone="primary"
            icon={<Info className="h-full w-full" />}
            className="border-01 bg-01"
            title="Grouping goes as far as tool × upstream × hour"
            description="Attributing spend to a specific task or code path is not available yet."
          />
        </>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title="No calls yet"
          description="Your agent has not made a call in this period. Calls appear here as they are made; a call that fails our checks is not charged."
        />
      ) : null}
    </div>
  );
}
