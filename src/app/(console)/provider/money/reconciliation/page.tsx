"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, EyeOff, Upload } from "lucide-react";
import * as React from "react";
import { useMemo, useState } from "react";

import {
  DisplayAssetSelect,
  displayAssetLabel,
  useDisplayAsset,
} from "@/components/display-asset-select";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import { formatCount } from "@/features/buyer/period";
import {
  assetScopeNote,
  foldClasses,
  observedTakeRate,
  pendingNote,
  rowsInAsset,
} from "@/features/call-classes/csv";
import { ClassName } from "@/features/call-classes/class-name";
import {
  downloadCallsCsv,
  exportErrorMessage,
  useCallsExport,
} from "@/features/call-classes/use-calls-export";
import type { Money } from "@/interfaces";
import { useChains } from "@/hooks/useChains";
import { ApiError } from "@/libs/ApiClient";
import { listProviderPayouts, payoutsInAsset } from "@/services/provider-payouts.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * Reconciliation — route
 * `/provider/money/reconciliation`. Console shell.
 *
 * ## There is no reconciliation endpoint
 *
 * `reconciliation_runs` holds hundreds of rows and **no controller reads them**
 * — `GET /providers/me/reconciliation` and `/reconciliation-runs` both answer
 * 404, measured. Nothing receives a provider's uploaded access log either. So
 * the run concept the frame draws has no feed, and this screen is assembled
 * from the same two sources the provider view uses: the per-call CSV export and the payout
 * ledger. Where the frame states a figure that only a completed run could
 * produce, the unknown treatment is rendered rather than a derived stand-in.
 *
 * That is three of the four figures in the Join strip and the Settlement
 * "Reconciles" cell. Each is annotated at its call site.
 *
 * ## What the screen can still answer
 *
 * The half of the reconciliation that lives on our side: how many calls we
 * recorded in the window, what class each fell into, and how the credited
 * classes add up to the money that left. Every row is joinable to the
 * provider's own log on `X-Assay-Call-Id`, which is the CSV's first column —
 * so the provider can complete the join themselves with the file the button
 * hands them, which is exactly what they would upload here if there were
 * anywhere to upload it to.
 *
 * ## Period
 *
 * The frame is drawn on a closed month ("July 2026", "as of 2026-08-01 00:00").
 * This renders the **current** UTC month to date, because a closed month with
 * no data would show an empty screen and the seeded traffic is in the month in
 * progress. The header states which month it is.
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

/** `2026-08-22 00:00` — the frame's own stamp format, no seconds, no suffix. */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

/**
 * The per-class note, verbatim from the design.
 *
 * These are NOT the notes the design writes for the same classes on the
 * provider view — these are mono, right-aligned and terser ("settled to you"
 * against "passed our checks and settled to you"). Both are the design's; neither is a paraphrase
 * of the other, so both live in their own screen.
 *
 * Two departures:
 *   - TEST reads "your own dry runs · 8 sessions" on the frame. The session
 *     count has no endpoint, and TEST has no producer at all today, so the
 *     count is dropped rather than invented.
 *   - PENDING is emitted by the wire and drawn by neither frame. Its note is
 *     OURS and depends on why the rows are pending: see `pendingNote`.
 */
const CLASS_NOTE: Record<string, string> = {
  PAID_CREDITED: "settled to you",
  PAID_AWAITING_REDEMPTION: "passed · credited once the voucher is redeemed on chain",
  PLATFORM_ABSORBED: "voucher could not be redeemed · owed to you by the platform, no fee",
  PROVIDER_FORFEITED: "voucher not collected: your stake was below the minimum or you were blocked · not credited, buyer not charged",
  PAID_UNCREDITED: "our checks rejected the response · see verdicts",
  FREE: "free-tier call · nothing charged, nothing paid",
  EXPLORATION: "trial traffic for a new binding, paid for by us",
  EXCLUDED: "excluded from the SLA window by our team",
  TEST: "your own dry runs",
  SYSTEM_ERROR: "your endpoint timed out or returned 5xx",
  REQUEST_ERROR: "4xx from your endpoint",
};

interface ClassRow {
  id: string;
  className: string;
  calls: string;
  share: string;
  credited: string;
  note: string;
}

interface SettlementRow {
  id: string;
  label: string;
  amount: string;
  note: string;
}

/**
 * One cell of the Join strip: a key, a big mono figure and a caption.
 *
 * The frame draws the figure at 22px mono/600; the mono scale steps 16 → 26, so
 * `mono-xl` is the nearest and this runs 4px large — a type-scale gap,
 * rather than fixed with an arbitrary value.
 */
function JoinStat({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  value: string;
  /** `$success-600` on the frame's Matched and Unexplained figures. */
  tone?: string;
  caption: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <p className="text-body-xs text-03">{label}</p>
      <p className={cn("font-mono text-mono-xl", tone ?? "text-01")}>{value}</p>
      <p className="font-mono text-mono-xs text-03">{caption}</p>
    </div>
  );
}

export default function ReconciliationPage() {
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => monthToDate(now), [now]);
  const [exporting, setExporting] = useState(false);

  const calls = useCallsExport(period);

  const payouts = useQuery({
    queryKey: ["provider", "payouts", "up28", period.from, period.to],
    queryFn: () => listProviderPayouts({ ...period, limit: 50 }),
  });

  /*
    One money figure, one asset. A provider paid in two assets picks one with
    the same selector as the earnings screens, and every figure below — calls,
    classes, settlement, batches — is that asset's. The CSV download stays the
    whole file: it carries an `asset` column of its own.
  */
  const { current: displayAsset, isPending: assetPending } = useDisplayAsset("provider");
  const rows = useMemo(
    () => (assetPending ? [] : rowsInAsset(calls.rows, displayAsset)),
    [calls.rows, assetPending, displayAsset]
  );
  const loading = calls.isLoading || assetPending;

  const classes = useMemo(() => foldClasses(rows), [rows]);
  const { chains } = useChains();
  const scopeNote =
    loading || !displayAsset || !calls.data
      ? null
      : assetScopeNote(calls.rows.length, rows.length, displayAssetLabel(displayAsset, chains));
  /*
    DELIBERATE DEPARTURE from the design's copy, and the same derivation the
    provider view uses so the two screens cannot disagree.

    The design hardcodes "Platform take (10%, verified)". The rate is
    configurable and can differ by verification tier, so a fixed 10% can sit
    directly above figures taken at a different rate on the one screen whose
    whole subject is a provider checking our arithmetic against theirs.

    "Platform take" and ", verified" are the frame's and stay. Only the rate is
    derived — measured from `platform_fee / price_amount` on the settled rows in
    this window — and it is labelled "observed" so it reads as measured rather
    than declared.
  */
  const observedTake = useMemo(() => observedTakeRate(rows), [rows]);

  const batchCount = new Set(
    (assetPending ? [] : payoutsInAsset(payouts.data?.items ?? [], displayAsset)).map(
      (p) => p.batchId
    )
  ).size;

  const gross = classes.totalGross;
  const fee = classes.totalFee;
  const net = classes.totalCredited;

  const classRows: ClassRow[] = classes.buckets.map((bucket) => ({
    id: bucket.className,
    className: bucket.className,
    calls: formatCount(bucket.calls),
    share: `${(bucket.share * 100).toFixed(1)}%`,
    credited: money(bucket.credited),
    note:
      bucket.className === "PENDING" ? pendingNote(rows) : (CLASS_NOTE[bucket.className] ?? ""),
  }));

  const classColumns: TableColumn<ClassRow>[] = [
    {
      key: "class",
      header: "Class",
      mono: true,
      noTruncate: true,
      cell: (r) => <ClassName name={r.className} />,
    },
    { key: "calls", header: "Calls", width: 140, align: "end", mono: true, cell: (r) => r.calls },
    { key: "share", header: "Share", width: 110, align: "end", mono: true, cell: (r) => r.share },
    {
      key: "credited",
      header: "Credited",
      width: 140,
      align: "end",
      mono: true,
      cell: (r) => r.credited,
    },
    {
      key: "note",
      header: "Note",
      width: 420,
      align: "end",
      mono: true,
      noTruncate: true,
      cell: (r) => r.note,
    },
  ];

  const settlementRows: SettlementRow[] = [
    { id: "gross", label: "Gross", amount: money(gross), note: "sum of credited classes" },
    {
      id: "take",
      // See `observedTake` above. With nothing observable the parenthesis keeps
      // only the frame's own word rather than printing a rate nobody paid.
      label: observedTake.summary
        ? `Platform take (${observedTake.summary}, verified)`
        : "Platform take (verified)",
      amount: fee ? `−${money(fee)}` : DASH,
      note: "take rate, no per-call fee floor",
    },
    {
      id: "net",
      label: "Net",
      amount: money(net),
      note: `paid in ${formatCount(batchCount)} batch${batchCount === 1 ? "" : "es"}`,
    },
  ];

  const settlementColumns: TableColumn<SettlementRow>[] = [
    // The frame leaves this header blank — the row labels name themselves.
    {
      key: "label",
      header: "",
      mono: true,
      cell: (r) => <span className="font-semibold">{r.label}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      width: 200,
      align: "end",
      mono: true,
      cell: (r) => r.amount,
    },
    {
      key: "note",
      header: "Note",
      width: 520,
      align: "end",
      mono: true,
      noTruncate: true,
      cell: (r) => r.note,
    },
  ];

  const error = [calls.error, payouts.error].find((e): e is ApiError => e instanceof ApiError);

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
    <>
      {/* Page Header. */}
      {/* Stacked below tablet, and the buttons wrap: side by side they are wider than 390. */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">
            Reconciliation · {MONTH.format(new Date(period.from))} · all bindings
          </h1>
          <p className="font-mono text-mono-12 text-03">
            joined on X-Assay-Call-Id · the unexplained bucket must be zero, and a non-zero one is
            our bug report, not your support ticket
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {/*
            Drawn enabled on the frame, rendered disabled here. No endpoint
            accepts a provider's access log — there is no upload route and no
            reconciliation-run route to feed. An enabled control that cannot
            act is the same failure as a search box that silently ignores you.
          */}
          <Button variant="secondary" disabled icon={<Upload />}>
            Upload your log
          </Button>
          <Button icon={<Download />} onClick={onExport} loading={exporting} disabled={!calls.data}>
            Download per-call CSV
          </Button>
        </div>
      </header>

      <DisplayAssetSelect scope="provider" />

      {error ? (
        <Banner
          tone="danger"
          title="This page could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {/*
        The export caps itself and says so in three headers. `meta` null means
        the cap was not readable, which is NOT "not truncated" — a reconciliation
        computed over a silently capped file is worse than no reconciliation.
        Both strings are OURS; the frame draws no slot for either.
      */}
      {calls.data && calls.meta?.truncated ? (
        <Banner
          tone="warning"
          title="This reconciliation is computed over a capped export"
          description={`The month matched ${formatCount(calls.meta.totalMatching)} calls in every asset and the file holds ${formatCount(calls.meta.rowCount)}. The classes below do not cover the whole month.`}
        />
      ) : null}
      {calls.data && !calls.meta ? (
        <Banner
          tone="warning"
          title="Whether this export is complete is not visible"
          description="The cap headers were not readable from the browser, so we cannot tell you whether the month matched more calls than the file holds."
        />
      ) : null}

      {scopeNote ? (
        <Banner tone="primary" title="One asset at a time" description={scopeNote} />
      ) : null}

      {/* Join — bg-01, radius-xl, 1px border-01, gap 40, padding [18, 22]. */}
      <div className="flex w-full items-center gap-10 rounded-xl border border-01 bg-01 px-[22px] py-[18px]">
        {/*
          Nothing receives a provider's access log, so there is no row count to
          state and no file to name. Both strings under this tile are OURS.
        */}
        <JoinStat label="Your log" value={DASH} caption="no access log has been uploaded" />
        <JoinStat
          label="Our ledger"
          value={loading ? DASH : `${formatCount(classes.totalCalls)} calls`}
          caption={`${displayAsset ? `in ${displayAssetLabel(displayAsset, chains)} · ` : ""}as of ${stamp(period.to)}`}
        />
        {/*
          Matched and Unexplained are the OUTPUT of a join with the provider's
          log. Without the log there is no numerator and no denominator, and a
          "100.0%" derived from our own side matching itself would be the most
          misleading figure on the screen. Both captions are OURS; the frame's
          "this is the number that matters" is kept because it is a statement
          about the metric, not about its value.
        */}
        <JoinStat label="Matched" value={DASH} caption="needs your log to compute" />
        <JoinStat label="Unexplained" value={DASH} caption="this is the number that matters" />
      </div>

      {/* Why we credited less than you served. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Why we credited less than you served</PanelTitle>
            <PanelDescription>
              every call falls into exactly one class
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        {/* The tables scroll inside their panels, as on the earnings screen. */}
        <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
          {classes.totalCalls > 0 ? (
            <Table
              columns={classColumns}
              rows={classRows}
              total={{
                label: "Total",
                values: {
                  calls: formatCount(classes.totalCalls),
                  share: "100%",
                  credited: money(classes.totalCredited),
                  /*
                    DELIBERATE DEPARTURE from the design's copy, and the twin
                    of the provider view's. **Do not "restore" it.**

                    The design's class-table total row writes "gross"
                    over the Credited column. That column sums
                    `provider_amount`, which is already net of the platform
                    fee: gross for this window is the $17.60 on the Settlement
                    panel below, not the $14.08 printed here.

                    On a reconciliation screen a $3.52 misstatement of a money
                    figure is disqualifying — the screen exists so a provider
                    can settle a disagreement with it, and one that cannot
                    describe its own column correctly cannot do that. Verbatim
                    copy loses to that. One word moves; nothing else does.
                  */
                  note: "net",
                },
              }}
              caption="Call classes"
            />
          ) : (
            /*
              The design draws no empty state. This copy is OURS — a table of zeroes
              would claim a 100% share of nothing, and there is nothing to
              reconcile until a call has been served.
            */
            <EmptyState
              className="m-2.5"
              icon={null}
              title="No calls this month"
              description="There is nothing to reconcile yet. Once a call reaches your endpoint it appears here with its class and its X-Assay-Call-Id."
            />
          )}
        </PanelBody>
      </Panel>

      {/* Settlement. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Settlement</PanelTitle>
            <PanelDescription>reconciles to the batch list on the earnings screen</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
          <Table
            columns={settlementColumns}
            rows={settlementRows}
            /*
              The frame writes a tick here. We cannot honestly write one: `Net`
              is an ACCRUAL over this month's calls and the payout rows are CASH
              that moved in this month, so the two are not the same quantity and
              a mismatch between them is normal rather than a finding. Asserting
              a reconciliation across them is exactly the derived claim the
              "render — and say so" rule exists to stop.
            */
            total={{
              label: "Reconciles",
              values: { amount: DASH, note: "net equals the sum of the batches" },
            }}
            caption="Settlement"
          />
        </PanelBody>
      </Panel>

      {/* Note — warning-10 on warning-20, eye-off, gap 10, padding 15. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-[15px]">
        <EyeOff
          width={15}
          height={15}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-warning-600"
        />
        <p className="min-w-0 flex-1 text-body-13 text-warning-700">
          Canary calls (our own test calls) are included in “Paid and credited” and are not labelled, so
          they cannot be told apart from real traffic. {MONTH_SHORT.format(new Date(period.from))} canary volume
          on your bindings: {DASH} calls.
        </p>
      </div>
    </>
  );
}
