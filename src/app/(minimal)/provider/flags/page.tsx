"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Flag, ShieldCheck, Webhook } from "lucide-react";
import * as React from "react";

import { Note } from "@/features/provider-binding/chrome";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { DASH, clockUtc, count, percent } from "@/features/g34a/stats";
import { isCredited, rowsOf, utcDay, utcDayStart, type ProviderCallRow } from "@/features/g34a/calls";
import { exportProviderCalls, getProviderQuality } from "@/services";
import { formatMoney } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";

/**
 * Verdicts and flags — route `/provider/flags`.
 *
 * The 56px Bar and its copy are the `(minimal)` layout's. This file is the
 * design's "Body".
 *
 * ## Scope
 *
 * the verdict feed screen (verdict feed) and the verdict detail screen (verdict detail) are **out of scope** and are
 * neither linked nor stubbed: `GET /verdicts` answers a provider persona with
 * an empty page — the resource is scoped to the payer's organisation, and a
 * provider is locked out of the verdicts on their own calls. Verified on the
 * wire, `200 {"items":[]}`, with 51 verification records in the database.
 *
 * ## Where the rows come from
 *
 * `/providers/me/calls/export` — the only provider endpoint that carries a
 * call. It is a CSV, so it is parsed (see `@/features/g34a/calls`) and the
 * table is filtered and searched **client-side**. That is why this screen does
 * have a search box while `payouts`, `sla-windows` and `tool-bindings` must
 * not: nothing is being sent to a `search` parameter the server ignores.
 *
 * `/providers/me/quality` supplies the header count and the verdict mix. Its
 * `verdictMix` and `totalCalls` are real; `paidQualityRate`, `freeQualityRate`
 * and `availabilityRate` are hard-coded `null` in `ProviderQualityService` and
 * render as the unknown glyph wherever they are wanted.
 *
 * ## What has no source
 *
 * - **Score.** No provider-visible response carries a verification score. The
 *   evidence pack that would is behind `/verdicts/{id}/evidence`, which is the
 *   resource this persona cannot read.
 * - **Agent.** The export has no agent column, and the payer's identity is not
 *   the provider's to see.
 * - **Why it failed**, as a rule name. The export's `reason` is the
 *   settlement path's sentence ("verification: judged and refunded by the
 *   worker"), not `MIN_ARRAY_LENGTH — 0 vessels returned`. It is shown
 *   as what it is.
 * - **Flag**, per row and in bulk. `POST /disputes` exists on the wire with a
 *   `VERDICT` / `PAYMENT_INTENT` subject, but `src/services/` has no disputes
 *   service and a screen may not add one, so every Flag control is disabled
 *   rather than enabled-and-inert.
 * - **Your flags.** `GET /disputes` answers this persona with an empty page,
 *   and `disputes` is deliberately unseeded. The panel renders its empty
 *   state.
 * - **Our false-positive rate**, and the 2% gate it is measured against. No
 *   endpoint publishes either number. The design's two explanatory sentences
 *   stay, because they describe the mechanism rather than the measurement.
 *
 * ## The counterfactual
 *
 * The design's one "Paid to you" column is two figures here, always both, per
 * the rule that listed and charged are never collapsed: the export's
 * `provider_amount` is the intent's column and is populated on a REFUNDED or
 * VOIDED intent too — it is what the provider *would* have earned. Showing it
 * as money received on a failed call would overstate earnings by exactly the
 * withheld amount. "Not charged" is an amount here, never a badge.
 *
 * ## Verdict wording
 *
 * Rule 03 forbids a raw verdict reaching the screen, and `ui/badge.tsx` has no
 * `label` prop for that reason. Every row's verdict is a closed-vocabulary
 * Badge plus `presentVerdict()`'s sentence as its title. Three of those
 * wordings are `provisional` (ours, not the design's) — `UNVERIFIED`,
 * `EMPTY_UNVERIFIED` and the null case — and this screen can reach the null
 * case, because an EXPIRED or VOIDED call has no verdict.
 */

const REFRESH_MS = 60_000;

/** How far back the table reads. The design's Bar says "in the last 24h". */
const WINDOW_DAYS = 14;

type Filter = "failed" | "passed" | "degraded" | "all";

/**
 * Wire verdict → the badge variant that says it without saying the token.
 *
 * `null` (an expired or voided call, which never reached a verdict) uses
 * `unverified`; `PENDING`-classified calls that are still VERIFYING use
 * `checking`.
 */
function badgeFor(row: ProviderCallRow): BadgeVariant {
  switch (row.verdict) {
    case "PASS":
      return "passed";
    case "FAIL":
      return "failed";
    case "DEGRADED":
      return "degraded";
    case "SKIPPED":
      return "not-sampled";
    case "EMPTY_CONFIRMED":
      return "passed";
    case "MISAPPLIED":
      return "failed";
    default:
      return row.status === "VERIFYING" ? "checking" : "unverified";
  }
}

function matchesFilter(row: ProviderCallRow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "failed") return row.verdict === "FAIL" || row.verdict === "MISAPPLIED";
  if (filter === "passed") return row.verdict === "PASS" || row.verdict === "EMPTY_CONFIRMED";
  return row.verdict === "DEGRADED";
}

interface CallTableRow extends TableRowData {
  call: ProviderCallRow;
}

export default function VerdictsAndFlagsPage() {
  const [filter, setFilter] = React.useState<Filter>("failed");
  const [term, setTerm] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [nowMs, setNowMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNowMs(Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS);
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, []);

  /* The design draws "⌘K" on the search box, so the shortcut has to exist. */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const range = React.useMemo(() => {
    if (nowMs === null) return null;
    const dayMs = 86_400_000;
    return {
      from: utcDay(utcDayStart(nowMs) - WINDOW_DAYS * dayMs),
      to: utcDay(utcDayStart(nowMs) + dayMs),
    };
  }, [nowMs]);

  const callsQuery = useQuery({
    queryKey: ["provider", "calls-export", range?.from, range?.to],
    queryFn: () => exportProviderCalls({ from: range!.from, to: range!.to }),
    enabled: range !== null,
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });

  const qualityQuery = useQuery({
    queryKey: ["provider", "quality", range?.from, range?.to],
    queryFn: () => getProviderQuality({ from: range!.from, to: range!.to }),
    enabled: range !== null,
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });

  const all = React.useMemo(() => rowsOf(callsQuery.data), [callsQuery.data]);

  const rows: CallTableRow[] = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return all
      .filter((row) => matchesFilter(row, filter))
      .filter((row) =>
        needle === ""
          ? true
          : row.callId.toLowerCase().includes(needle) ||
            row.intentId.toLowerCase().includes(needle) ||
            row.reason.toLowerCase().includes(needle) ||
            row.classification.toLowerCase().includes(needle)
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((row) => ({ id: row.callId || row.intentId, call: row }));
  }, [all, filter, term]);

  const failedInMix =
    qualityQuery.data?.verdictMix.find((entry) => entry.verdict === "FAIL")?.calls ?? null;

  const columns: TableColumn<CallTableRow>[] = [
    {
      key: "time",
      header: "Time",
      cell: (r) => clockUtc(r.call.createdAt),
      width: 100,
      align: "start",
      mono: true,
    },
    {
      key: "callId",
      header: "Call id",
      cell: (r) => r.call.callId || DASH,
      width: 120,
      align: "start",
      mono: true,
    },
    {
      key: "verdict",
      header: "Verdict",
      cell: (r) => {
        const presented = presentVerdict(r.call.verdict ?? undefined);
        return <Badge variant={badgeFor(r.call)} title={presented.shownAs} />;
      },
      width: 110,
      align: "start",
    },
    { key: "score", header: "Score", cell: () => DASH, width: 60, align: "start", mono: true },
    {
      key: "why",
      header: "Why it failed",
      cell: (r) => <span title={r.call.reason || undefined}>{r.call.reason || DASH}</span>,
    },
    { key: "agent", header: "Agent", cell: () => DASH, width: 80, align: "start", mono: true },
    {
      /*
        The counterfactual, as two figures in one cell rather than two columns.

        Both must always render — `provider_amount` is what this call was worth
        to the provider and is populated on a REFUNDED intent too, so showing
        it alone would report money that was never received. Two columns is the
        cleaner shape and was the first attempt; measured at the design's 1440
        it left the "Why it failed" column 90px, which ellipsised the one cell
        that carries the row's meaning. One cell, two stacked amounts, and
        "not paid" written as an AMOUNT — never a badge.
      */
      key: "paid",
      header: "Paid to you",
      cell: (r) => {
        const credited = isCredited(r.call);
        const zero = { ...r.call.providerAmount, amount: "0" };
        return (
          <span className="flex flex-col items-end leading-tight">
            <span className="text-teal-600">
              {formatMoney(credited ? r.call.providerAmount : zero, { decimals: 4 })}
            </span>
            <span className="text-02">
              {credited
                ? `of ${formatMoney(r.call.providerAmount, { decimals: 4 })}`
                : `not paid ${formatMoney(r.call.providerAmount, { decimals: 4 })}`}
            </span>
          </span>
        );
      },
      width: 130,
      align: "end",
      mono: true,
      noTruncate: true,
    },
    {
      key: "flag",
      header: "",
      cell: () => (
        <Button
          size="sm"
          variant="secondary"
          icon={<Flag aria-hidden="true" />}
          disabled
          title="Filing a flag needs POST /disputes, which has no service in this app yet."
        >
          Flag
        </Button>
      ),
      width: 80,
      align: "end",
    },
  ];

  return (
    <>
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h1 className="truncate text-heading-lg text-01">Verdicts</h1>
          <p className="text-body-sm leading-[1.55] text-02">
            Every call we checked, and what we decided. If we got one wrong, say so — that is
            the only way the number below improves.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            icon={<Download aria-hidden="true" />}
            disabled={!callsQuery.data}
            onClick={() => {
              const exported = callsQuery.data;
              if (!exported) return;
              const url = URL.createObjectURL(
                new Blob([exported.csv], { type: "text/csv;charset=utf-8" })
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = exported.filename ?? `calls-${range?.from}_${range?.to}.csv`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            icon={<Webhook aria-hidden="true" />}
            disabled
            title="A binding carries no webhook URL field, and no endpoint registers a stream."
          >
            Webhook stream
          </Button>
        </div>
      </header>

      {/* ── Note ───────────────────────────────────────────────── */}
      <Note tone="teal" icon={<ShieldCheck aria-hidden="true" className="size-[15px]" />}>
        A failed verdict costs you money: on DATA_FAIL your stake is slashed and the buyer is
        compensated out of the penalty. That is why every verdict here carries its evidence
        pack, why you can dispute one, and why we publish our own false-positive rate against
        the gate.
      </Note>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex w-full flex-wrap items-center gap-2.5">
        <Segmented
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          aria-label="Verdict filter"
        >
          <SegmentedItem value="failed">failed</SegmentedItem>
          <SegmentedItem value="passed">passed</SegmentedItem>
          <SegmentedItem value="degraded">degraded</SegmentedItem>
          <SegmentedItem value="all">all</SegmentedItem>
        </Segmented>

        <Search
          ref={searchRef}
          wrapperClassName="w-[280px]"
          placeholder="call id, rule or agent…"
          aria-label="Search verdicts"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />

        {/* The 72h retention window is the evidence policy, and the chip states it. */}
        <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] text-02">
          BODIES KEPT 72H
        </span>
      </div>

      {/* ── Row ───────────────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <Panel className="w-full min-w-0 flex-1">
          <PanelBody className="px-2.5 pb-2.5 pt-4">
            {rows.length > 0 ? (
              /* Eight fixed columns give this table a hard min width; below the
                 design's 1440 it scrolls inside its own box, never the page. */
              <div className="w-full overflow-x-auto">
                <Table
                  caption="Verdicts on your calls"
                  columns={columns}
                  rows={rows}
                  className="min-w-[840px]"
                />
              </div>
            ) : (
              <EmptyState
                title={
                  callsQuery.isLoading
                    ? "Loading your calls…"
                    : all.length === 0
                      ? "No calls in the last 14 days"
                      : "No calls match this filter"
                }
                description={
                  all.length === 0
                    ? "Verdicts appear here once agents start calling your bindings."
                    : "Try another verdict filter, or clear the search."
                }
              />
            )}
          </PanelBody>
        </Panel>

        {/* ── Rail (400) ────────────────────────────────────────── */}
        <div className="flex w-full flex-col gap-4 tablet:w-[400px] tablet:shrink">
          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Your flags</PanelTitle>
                <PanelDescription>none filed</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <EmptyState
                title="You have not flagged a verdict"
                description="Flagging needs a disputes service this app does not have yet, and the disputes a provider files are not readable back on this persona."
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Our false-positive rate</PanelTitle>
                <PanelDescription>published monthly, for everyone</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <div className="flex w-full flex-col gap-1">
                <p className="font-mono text-mono-2xl text-teal-600">{DASH}</p>
                <p className="text-body-13 leading-[1.55] text-02">
                  No endpoint publishes the false-positive rate or the gate it is measured
                  against, so neither figure is shown.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2">
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-label-13 text-01">Against the 2% gate</span>
                  <span className="font-mono text-mono-13 text-02">{DASH} of 2.0%</span>
                </div>
                <p className="text-body-xs leading-[1.4] text-03">
                  Below 2% sustained, slashing turns on for that policy — one policy at a time,
                  not all at once. Until then every penalty is calculated, signed and shown to
                  you, but never sent to the settlement program.
                </p>
              </div>

              {/*
                What this persona CAN see about its own verdicts: the mix, which
                is real, and the three rates, which are null by construction.
              */}
              <dl className="flex w-full flex-col gap-2 border-t border-01 pt-3.5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body-13 text-02">failed verdicts, last {WINDOW_DAYS}d</dt>
                  <dd className="font-mono text-mono-13 font-semibold text-01">
                    {count(failedInMix)}
                    {qualityQuery.data ? ` of ${count(qualityQuery.data.totalCalls)}` : ""}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body-13 text-02">paid quality rate</dt>
                  <dd className="font-mono text-mono-13 font-semibold text-01">
                    {percent(qualityQuery.data?.paidQualityRate ?? null, 1)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body-13 text-02">free quality rate</dt>
                  <dd className="font-mono text-mono-13 font-semibold text-01">
                    {percent(qualityQuery.data?.freeQualityRate ?? null, 1)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body-13 text-02">availability rate</dt>
                  <dd className="font-mono text-mono-13 font-semibold text-01">
                    {percent(qualityQuery.data?.availabilityRate ?? null, 1)}
                  </dd>
                </div>
              </dl>
            </PanelBody>
          </Panel>
        </div>
      </section>
    </>
  );
}
