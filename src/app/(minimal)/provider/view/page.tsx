"use client";

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { CircleCheck, Download, Info } from "lucide-react";
import * as React from "react";
import { useMemo, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  capSeries,
  StackedBarChart,
  type ChartBar,
  type ChartSeries,
} from "@/components/ui/stacked-bar-chart";
import { Table, type TableColumn } from "@/components/ui/table";
import { axisLabel, formatCount } from "@/features/buyer/period";
import {
  callsOnDay,
  foldClasses,
  foldNotCredited,
  foldTraffic,
  observedTakeRate,
  type CallRow,
} from "@/features/call-classes/csv";
import {
  downloadCallsCsv,
  exportErrorMessage,
  useCallsExport,
} from "@/features/call-classes/use-calls-export";
import type { Money, ProviderPayout } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listProviderPayouts } from "@/services/provider-payouts.service";
import { getProviderEarnings, getProviderQuality } from "@/services/provider-reports.service";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";
import { toast } from "@/utils/toast";

/**
 * Provider view — route `/provider/view`.
 *
 * The 56px bar is the `(minimal)` layout's; nothing here draws a shell. The
 * frame's Body is the one that diverges from the other four minimal
 * screens — `gap 18`, `padding [24, 28]` against their `gap 16`, `[22, 26]` —
 * so the layout's default is cancelled and re-applied on this page's root,
 * which is what the layout's own docstring asks for.
 *
 * ## What this screen is for
 *
 * A provider counts N requests in their access log and we count M. The
 * "Why our count differs from your access log" panel is the answer, and every
 * row in it is joinable to their log line by line on `X-X402-Call-Id` — the
 * per-call CSV's first column, and the header the router puts on every upstream
 * request. That panel is the screen; the three above it are context.
 *
 * ## One file, five tables
 *
 * `GET /providers/me/calls/export` is fetched once (`useCallsExport`) and folded
 * four ways: the class table, the not-credited table, the 7-day traffic bars and
 * the calls-today tile. Using one source means the four cannot disagree about
 * the same window, and it is the same bytes the export button hands over — the
 * provider can reproduce every figure on this page from the file they download.
 *
 * Folding it is not free of judgement, and the judgement is in `csv.ts`: the CSV
 * carries `provider_amount` on **every** row including the refunded and expired
 * ones, so "Paid to you" counts only rows whose intent SETTLED. Verified against
 * `GET /providers/me/earnings`: the credited sum equals `totals.earned` and the
 * rest equals `totals.withheld`, to the minor unit.
 *
 * ## What has no source
 *
 * - **p95 latency.** `ProviderStats.p95LatencyMs`, `p50LatencyMs` and every
 *   traffic bucket's latency field are hard-coded `null` in the backend. The
 *   tile shows the unknown treatment; the "vs 8,000ms timeout" line under it is
 *   the frame's own copy.
 * - **"pending" and "next batch".** No provider route reports an unpaid balance
 *   and none reports the payout scheduler's next run. Deriving pending as
 *   (earned − paid out) would put a real-looking figure under a label that means
 *   something else, across two windows that do not line up.
 * - **Period, Calls, Gross and Take on a payout row.** A `PAYOUT` ledger entry
 *   carries `batchId`, `amount`, `chainTxRef` and `createdAt`, and nothing links
 *   it to the calls it settled. Four dashed columns, the same four dashes the earnings screen uses.
 * - **A verification rule breakdown.** See `foldNotCredited`.
 *
 * ## Money
 *
 * Minor units in a string, always through `formatMoney`. `formatMoney(null)`
 * answers `"$0.00"`, so every nullable amount goes through `money()` and comes
 * out as a dash instead — a null is "no rows matched", not "zero dollars".
 */

const DASH = "—";

/** `formatMoney` renders a null as `$0.00`; on this screen that is a lie. */
function money(value: Money | null | undefined, decimals = 2): string {
  if (!value) return DASH;
  return formatMoney(value, { decimals });
}

/** `[from, to)` for the current UTC calendar month, `to` capped at tomorrow. */
function monthToDate(now: Date): { from: string; to: string } {
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** The frame's own elision for a transaction reference (`5j7s…Qm2A`). */
function shortTx(ref: string | null): string {
  if (!ref) return DASH;
  return ref.length <= 12 ? ref : `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

/** "▲ 6% vs yesterday", the frame's own wording, over call counts. */
function trend(today: number, yesterday: number): string {
  if (yesterday === 0) return "no comparable day";
  const delta = ((today - yesterday) / yesterday) * 100;
  if (Math.round(delta) === 0) return "no change vs yesterday";
  return `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))}% vs yesterday`;
}

/**
 * Five axis labels over a round maximum, so the four gaps between them are
 * equal — the frame draws `$4 $3 $2 $1 $0` and nothing else would line up.
 */
function axisTicks(max: number): { ticks: string[]; scaleMax: number } {
  const scaleMax = Math.max(4, Math.ceil(max / 4) * 4);
  return {
    ticks: [4, 3, 2, 1, 0].map((i) => formatCount((scaleMax / 4) * i)),
    scaleMax,
  };
}

/**
 * The per-class note, verbatim from the two frames.
 *
 * The provider-view design writes six of these and the reconciliation design
 * supplies EXPLORATION and EXCLUDED, which this design does not draw but the
 * wire does emit. PENDING is emitted by the wire and drawn by neither design,
 * so that one sentence is not from the design.
 */
const CLASS_NOTE: Record<string, string> = {
  PAID_CREDITED: "passed our checks and settled to you",
  PAID_AWAITING_REDEMPTION: "passed our checks — credited once the voucher is redeemed on chain",
  PAID_UNCREDITED:
    "our checks rejected the response — not charged to the buyer, not credited to you",
  FREE: "relay path, no payment machinery",
  EXPLORATION: "NEW-binding traffic, we paid for it",
  EXCLUDED: "excluded from the SLA window by an operator decision",
  TEST: "our own dry runs against your endpoint",
  SYSTEM_ERROR: "your endpoint timed out or returned 5xx",
  REQUEST_ERROR: "4xx from your endpoint",
  // Not from the design. No frame draws a PENDING row; the wire emits one and the totals have
  // to add up.
  PENDING: "still in flight — judged, credited or refunded shortly",
};

interface ClassRow {
  id: string;
  className: string;
  calls: string;
  callsTone?: string;
  share: string;
  paid: string;
  note: string;
}

interface FailRow {
  id: string;
  reason: string;
  calls: string;
  notCredited: string;
}

interface BatchRow {
  id: string;
  batch: string;
  period: string;
  calls: string;
  gross: string;
  take: string;
  net: string;
  tx: string;
}

export default function ProviderViewPage() {
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => monthToDate(now), [now]);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  const [exporting, setExporting] = useState(false);

  const calls = useCallsExport(period);

  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "m40"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  const quality = useQuery({
    queryKey: ["provider", "quality", period.from, period.to],
    queryFn: () => getProviderQuality(period),
  });

  const earnings = useQuery({
    queryKey: ["provider", "earnings", "day", period.from, period.to],
    queryFn: () => getProviderEarnings({ ...period, groupBy: "day" }),
  });

  const payouts = useQuery({
    queryKey: ["provider", "payouts", "m40", period.from, period.to],
    queryFn: () => listProviderPayouts({ ...period, limit: 20 }),
  });

  const rows: CallRow[] = calls.rows;

  // ── Tiles ────────────────────────────────────────────────────────────────

  const callsToday = callsOnDay(rows, today);
  const callsYesterday = callsOnDay(rows, yesterday);

  const mix = quality.data?.verdictMix ?? [];
  const passed = mix.find((m) => m.verdict === "PASS")?.calls ?? 0;
  const failed = mix.find((m) => m.verdict === "FAIL")?.calls ?? 0;
  /*
    `paidQualityRate`, `freeQualityRate` and `availabilityRate` are hard-coded
    null in the backend, so the tile is computed from `verdictMix`, which is
    real — and the sub-line names its two terms so the denominator is not a
    guess. A window in which nothing was judged has no rate, which is not 0%.
  */
  const judged = passed + failed;
  const qualityRate = judged === 0 ? DASH : `${((passed / judged) * 100).toFixed(1)}%`;

  const earningsToday = earnings.data?.groups.find((g) => g.key === today)?.earned ?? null;

  // ── Traffic ──────────────────────────────────────────────────────────────

  const toolLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const binding of bindings.data?.items ?? []) {
      map.set(binding.toolId, labelForEndpoint(binding.endpoint));
    }
    return map;
  }, [bindings.data]);

  const chart = useMemo(() => {
    const days = foldTraffic(rows, now, 7);
    const toolIds = [...new Set(days.flatMap((d) => Object.keys(d.byTool)))];
    const tones: ChartSeries["tone"][] = [1, 4, 3, 2, 5];
    const series: ChartSeries[] = toolIds.map((id, i) => ({
      key: id,
      // No endpoint exposes a tool name; the binding's endpoint host is the
      // only human-readable identifier the wire carries. One shared helper.
      label: toolLabel.get(id) ?? id.slice(0, 8),
      tone: tones[i % tones.length],
    }));
    const bars: ChartBar[] = days.map((d) => ({ label: axisLabel(d.day), values: d.byTool }));
    const capped = capSeries(series, bars, 3);
    const max = Math.max(
      0,
      ...capped.bars.map((b) => Object.values(b.values).reduce((a, v) => a + v, 0))
    );
    return { ...capped, ...axisTicks(max) };
  }, [rows, now, toolLabel]);

  // ── Tables ───────────────────────────────────────────────────────────────

  const classes = useMemo(() => foldClasses(rows), [rows]);
  const notCredited = useMemo(() => foldNotCredited(rows), [rows]);
  /*
    DELIBERATE DEPARTURE from the design's copy.

    The design hardcodes "Take (10%)". The take rate is configurable and can
    differ by verification tier, so a fixed percentage is one tier's copy on a
    screen that serves every tier, and it can sit above a column of figures
    taken at a different rate.

    The word "Take" is the frame's and stays. Only the parenthesis is derived,
    from `platform_fee / price_amount` on the settled rows actually in the
    window, and it is labelled "observed" so it cannot be read as a declared
    rate. A window spanning two tiers reports both bounds rather than a mean.
  */
  const observedTake = useMemo(() => observedTakeRate(rows), [rows]);

  const classRows: ClassRow[] = [
    ...classes.buckets.map((bucket) => ({
      id: bucket.className,
      className: bucket.className,
      calls: formatCount(bucket.calls),
      share: `${(bucket.share * 100).toFixed(1)}%`,
      paid: money(bucket.credited),
      note: CLASS_NOTE[bucket.className] ?? "",
    })),
    {
      /*
        The frame's own row, and the only one that is a claim rather than a
        count: it holds calls WE recorded that fall into no class at all. It is
        not the count of the provider's log lines we cannot match — that needs
        their log, and no endpoint receives one.
      */
      id: "__unexplained",
      className: "Unexplained",
      calls: formatCount(classes.unexplained),
      callsTone: classes.unexplained === 0 ? "text-success-600" : undefined,
      share: `${classes.totalCalls === 0 ? "0.0" : ((classes.unexplained / classes.totalCalls) * 100).toFixed(1)}%`,
      paid: DASH,
      note: "must be zero — a non-zero row here is our bug report, not your support ticket",
    },
  ];

  const classColumns: TableColumn<ClassRow>[] = [
    {
      key: "class",
      header: "Class",
      mono: true,
      cell: (r) => <span className="font-semibold">{r.className}</span>,
    },
    {
      key: "calls",
      header: "Calls",
      width: 140,
      align: "end",
      mono: true,
      cell: (r) => (r.callsTone ? <span className={r.callsTone}>{r.calls}</span> : r.calls),
    },
    { key: "share", header: "Share", width: 110, align: "end", mono: true, cell: (r) => r.share },
    {
      key: "paid",
      // The frame paints this header teal — it is the counterfactual column.
      header: <span className="text-teal-600">Paid to you</span>,
      width: 150,
      align: "end",
      mono: true,
      cell: (r) => r.paid,
    },
    {
      key: "note",
      header: "Note",
      width: 420,
      align: "start",
      noTruncate: true,
      // The frame writes the note in SANS at 12.5/400. Table's non-mono default
      // is `text-label-sm` (14/600), so the size and weight are restated here.
      cell: (r) => <span className="text-body-xs font-normal">{r.note}</span>,
    },
  ];

  const failRows: FailRow[] = notCredited.buckets.map((bucket) => ({
    id: bucket.className,
    reason: bucket.className,
    calls: formatCount(bucket.calls),
    notCredited: money(bucket.notCredited, 3),
  }));

  const failColumns: TableColumn<FailRow>[] = [
    {
      key: "reason",
      header: "Reason a call failed",
      mono: true,
      cell: (r) => <span className="font-semibold">{r.reason}</span>,
    },
    { key: "calls", header: "Calls", width: 120, align: "end", mono: true, cell: (r) => r.calls },
    {
      key: "notCredited",
      header: "Not credited",
      width: 150,
      align: "end",
      mono: true,
      cell: (r) => r.notCredited,
    },
  ];

  /*
    One row per PAYOUT ledger entry, not per batch. `batchId` is deterministic
    on the wire, so the same id recurs across runs and grouping on it would
    merge two payout runs into one row — the same call the earnings screen makes.
  */
  const batchRows: BatchRow[] = (payouts.data?.items ?? []).map((payout: ProviderPayout) => ({
    id: payout.id,
    batch: payout.batchId.slice(0, 8),
    period: DASH,
    calls: DASH,
    gross: DASH,
    take: DASH,
    net: money(payout.amount),
    tx: shortTx(payout.chainTxRef),
  }));

  const batchColumns: TableColumn<BatchRow>[] = [
    {
      key: "batch",
      header: "Batch",
      mono: true,
      cell: (r) => <span className="font-semibold">{r.batch}</span>,
    },
    { key: "period", header: "Period", width: 240, align: "end", mono: true, cell: (r) => r.period },
    { key: "calls", header: "Calls", width: 130, align: "end", mono: true, cell: (r) => r.calls },
    { key: "gross", header: "Gross", width: 130, align: "end", mono: true, cell: (r) => r.gross },
    {
      key: "take",
      // The frame's word, a measured parenthesis — see `observedTake` above.
      // No parenthesis at all when the window realised no fee: there is then
      // nothing observed, and a rate nobody paid must not be printed.
      header: observedTake.summary ? `Take (${observedTake.summary})` : "Take",
      /*
        The frame's width is 140, and "Take (observed 20%)" measures 135 in it.
        A two-tier window would print "Take (observed, mixed 5–20%)", which
        does not fit and — because `ui/table.tsx` puts no truncation on a
        header — would silently overlap Gross. Widening only in that state
        keeps the frame's geometry everywhere it applies and keeps the mixed
        signal legible where it does not. No window can reach it today.
      */
      width: observedTake.rates.length > 1 ? 200 : 140,
      align: "end",
      mono: true,
      cell: (r) => r.take,
    },
    { key: "net", header: "Net", width: 130, align: "end", mono: true, cell: (r) => r.net },
    { key: "tx", header: "Tx", width: 170, align: "end", mono: true, cell: (r) => r.tx },
  ];

  const monthLabel = `${new Date(period.from).getUTCDate()} – ${new Date(now).getUTCDate()} ${now.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
  const batchCount = new Set((payouts.data?.items ?? []).map((p) => p.batchId)).size;
  const totals = earnings.data?.totals;
  const grossTotal =
    totals?.earned && totals?.platformFee
      ? {
          amount: new Decimal(totals.earned.amount).plus(totals.platformFee.amount).toFixed(0),
          asset: totals.earned.asset,
          decimals: totals.earned.decimals,
        }
      : null;

  const error = [calls.error, bindings.error, quality.error, earnings.error, payouts.error].find(
    (e): e is ApiError => e instanceof ApiError
  );

  async function onExport() {
    setExporting(true);
    try {
      const file = calls.data ?? null;
      if (!file) throw new Error("no export loaded");
      downloadCallsCsv(file.csv, file.filename, file.meta);
    } catch (e) {
      toast.error(exportErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    /*
      The frame's Body is gap 18 / padding [24, 28]; the `(minimal)`
      layout applies the three-way majority (gap 16 / [22, 26]) that the other
      four minimal screens share. Cancelling it here rather than special-casing
      the layout is what that layout's docstring asks for.
    */
    <div className="-mx-[26px] -my-[22px] flex flex-1 flex-col gap-[18px] px-7 py-6">
      {/* Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h1 className="text-heading-md text-01">Your traffic and earnings</h1>
          <p className="text-body-sm text-02">
            Three panels and an export. Everything you configure lives in the binding editor and
            the stake page — this is where you watch what it earns and what it costs you.
          </p>
        </div>
        <Button
          icon={<Download />}
          onClick={onExport}
          loading={exporting}
          disabled={!calls.data}
          className="shrink-0"
        >
          Per-call CSV
        </Button>
      </header>

      {error ? (
        <Banner
          tone="danger"
          title="This page could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {/*
        The cap is only ever announced when it bites. `meta` null is "the cap is
        unknown", which is a different fact from "not truncated" and gets its
        own sentence rather than silence. Neither string is from the design —
        the frame draws no slot for either.
      */}
      {calls.data && calls.meta?.truncated ? (
        <Banner
          tone="warning"
          title="This export is capped"
          description={`The window matched ${formatCount(calls.meta.totalMatching)} calls and the file holds ${formatCount(calls.meta.rowCount)}. Every figure below is computed over the capped file.`}
        />
      ) : null}
      {calls.data && !calls.meta ? (
        <Banner
          tone="warning"
          title="Whether this export is complete is not visible"
          description="The cap headers were not readable from the browser, so we cannot tell you whether the window matched more calls than the file holds."
        />
      ) : null}

      {/* Tiles — row, gap 14, four equal tiles. */}
      <div className="flex w-full gap-3.5">
        <MetricTile
          label="Calls today"
          value={calls.isLoading ? DASH : formatCount(callsToday)}
          sub={calls.isLoading ? DASH : trend(callsToday, callsYesterday)}
        />
        <MetricTile
          label="Quality rate"
          value={quality.isLoading ? DASH : qualityRate}
          sub={
            quality.isLoading
              ? DASH
              : `${formatCount(passed)} verified, ${formatCount(failed)} failed`
          }
        />
        {/*
          `p95LatencyMs` is hard-coded null on `/providers/me`, on
          `/providers/me/traffic` and everywhere else. The sub-line is the
          frame's own copy and states the timeout, not a measurement.
        */}
        <MetricTile label="p95 latency" value={DASH} sub="vs 8,000ms timeout" />
        <MetricTile
          label="Earnings today"
          value={earnings.isLoading ? DASH : money(earningsToday)}
          // Not the design's shape: the frame writes "pending $18.22 · next batch
          // 22m" and neither figure has an endpoint behind it.
          sub={`pending ${DASH} · next batch ${DASH}`}
        />
      </div>

      {/* Row — Traffic fills, Quality is a fixed 520. */}
      <div className="flex w-full items-start gap-4">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Traffic</PanelTitle>
              <PanelDescription>by day, last 7 days</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            {/*
              The frame's Y axis is in dollars; this one counts calls. A panel
              named Traffic sitting under a "Calls today" tile and above an
              Earnings panel that carries the money is the one place a $ axis
              would be read as a second, disagreeing earnings figure. A deliberate
              divergence.
            */}
            <StackedBarChart
              series={chart.series}
              bars={chart.bars}
              ticks={chart.ticks}
              scaleMax={chart.scaleMax}
              caption="Calls per day, split by tool, over the last seven days"
            />
          </PanelBody>
        </Panel>

        <Panel className="w-[520px] shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Quality</PanelTitle>
              <PanelDescription className="whitespace-normal">
                the share of calls that passed our checks — this is the number agents see next to
                your tool
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [6, 10, 10, 10], no gap. */}
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            <Table
              columns={failColumns}
              rows={failRows}
              total={{
                label: "Total",
                values: {
                  calls: formatCount(notCredited.calls),
                  notCredited: money(notCredited.notCredited, 3),
                },
              }}
              caption="Why calls were not credited"
            />
            {/* Note — teal-10 on teal-20, circle-check, gap 10, p 15. */}
            <div className="flex w-full items-start gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-[15px]">
              <CircleCheck
                width={15}
                height={15}
                strokeWidth={1.5}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-teal-600"
              />
              <p className="min-w-0 flex-1 text-body-13 text-01">
                A rejected call is not charged to the buyer and not credited to you. Once slashing
                is live it also costs part of your stake — during shadow mode you see that amount
                before any of it is real. Flag anything you think is wrong.
              </p>
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* Earnings. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Earnings</PanelTitle>
            <PanelDescription>
              paid on-chain as calls settle — we do not claw back a payout and hold no reserve
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          <Table
            columns={batchColumns}
            rows={batchRows}
            /*
              The frame's own totals row is a DIFFERENT scope from the rows above
              it — three hourly batches over a "Month to date" total of 31. So
              this one states the month's earnings document rather than summing
              the payout entries listed, and says which month in the Period cell.
            */
            total={{
              label: "Month to date",
              values: {
                period: monthLabel,
                calls: totals ? formatCount(totals.calls) : DASH,
                gross: money(grossTotal),
                take: totals?.platformFee ? `−${money(totals.platformFee)}` : DASH,
                net: money(totals?.earned),
                tx: `${formatCount(batchCount)} batch${batchCount === 1 ? "" : "es"}`,
              },
            }}
            caption="Payout batches"
          />
        </PanelBody>
      </Panel>

      {/* Call classes — the reason this screen exists. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Why our count differs from your access log</PanelTitle>
            <PanelDescription>
              every upstream request carries X-X402-Call-Id · the per-call CSV carries the same id
              and one of these classes, so the two can be joined line by line
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {classes.totalCalls > 0 ? (
            <Table
              columns={classColumns}
              rows={classRows}
              total={{
                label: "Total",
                values: {
                  calls: formatCount(classes.totalCalls),
                  share: "100%",
                  paid: money(classes.totalCredited),
                  /*
                    DELIBERATE DEPARTURE from the design's copy — the second
                    on this screen, after the take-rate parenthesis above.
                    **Do not "restore" it.**

                    The design's Call classes total row writes
                    "gross, before the 10% take". The word "gross" is wrong
                    about this column: "Paid to you" sums `provider_amount`,
                    which is already net of the platform fee. Gross for this
                    window is $17.60 against the $14.08 printed here — the
                    sentence misstates a money figure by $3.52.

                    It is wrong on the one screen whose entire job is making a
                    provider's numbers add up against their own access log. A
                    screen that cannot describe its own column correctly cannot
                    be used to settle a disagreement, which is what this screen is for.
                    Verbatim copy loses to that.

                    One word moves. The rate is the measured one from
                    `observedTake`; every other word is the frame's.
                  */
                  note: (
                    <span className="text-body-xs font-semibold">
                      net of the {observedTake.words ?? "platform"} take
                    </span>
                  ),
                },
              }}
              caption="Call classes"
            />
          ) : (
            /*
              The design draws no empty state — it has eight rows and nothing else.
              This copy is not from the design. A table of zeroes
              would claim a 100% share of nothing, and the one thing a provider
              with no traffic needs to know is that the join key already exists.
            */
            <EmptyState
              className="m-2.5"
              icon={null}
              title="No calls this month"
              description="Once a call reaches your endpoint it appears here with its class and its X-X402-Call-Id, and the same id is on the request we sent you."
            />
          )}
        </PanelBody>
      </Panel>

      {/* Note — bg-02, radius-lg, 1px border-01, gap 10, padding 15. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
        <Info
          width={15}
          height={15}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-03"
        />
        <p className="min-w-0 flex-1 text-body-13 text-02">
          Slashing is not live yet. These calls were not credited and, once slashing turns on,
          would also have cost stake — the amount is shown on your verdict feed so you can see it
          before it is real. Flag anything you think is wrong.
        </p>
      </div>
    </div>
  );
}
