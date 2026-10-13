"use client";

import { DisplayAssetSelect } from "@/components/display-asset-select";
import { ArrowRight, Calendar, Info } from "lucide-react";
import { useMemo } from "react";

import { WalletSetupBanner } from "@/components/auth/wallet-setup-banner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { CardRow } from "@/components/ui/card-row";
import { Table, type TableColumn } from "@/components/ui/table";
import {
  formatCount,
  isZeroMoney,
  sharePercent,
  shortId,
} from "@/features/buyer/period";
import {
  useGuarantee,
  type FailureReason,
  type MonthRow,
} from "@/features/buyer/use-guarantee";
import { isWalletNotLinked } from "@/features/auth/wallet-link";
import type { WithheldBucket } from "@/features/buyer/wire";
import { formatMoney } from "@/utils/money";

/**
 * Guarantee — "what we did not charge you for" (design).
 *
 * The product's claim is invisible by construction: a refund here is a hold
 * being released, so it never appears as a line on a statement and the balance
 * never moves. This screen is the only place the claim becomes a figure, which
 * is why every number on it is stated by the API rather than inferred here, and
 * why the page header carries the identity it can be checked against
 * (`withheld == Σ HOLD_RELEASE`).
 *
 * All copy is verbatim from the design frame. The empty-state copy comes from
 * the product spec, which writes the one case the design does not draw.
 */

/**
 * The design writes its own words for the two buckets the API emits; the API's
 * own `label` ("failed verification") is the fallback for a bucket added later,
 * so a new terminal state degrades to plain wording rather than to a blank.
 */
const BUCKET_COPY: Record<string, { key: string; note: string }> = {
  FAILED_VERIFICATION: { key: "Failed our checks", note: "the guarantee" },
  PROVIDER_OR_PLATFORM_ERROR: {
    key: "Provider or platform error",
    note: "never your fault, never charged",
  },
};

function DecompositionRow({
  label,
  sub,
  value,
  total = false,
}: {
  label: string;
  sub: string;
  value: string;
  total?: boolean;
}) {
  return (
    <div
      className={
        total
          ? "flex w-full items-center gap-4 border-t border-02 pt-3"
          : "flex w-full items-center gap-4 py-2"
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={total ? "text-label-sm text-01" : "text-body-sm text-01"}>{label}</p>
        <p className="text-body-xs text-03">{sub}</p>
      </div>
      <p
        className={
          total
            ? "shrink-0 font-mono text-mono-sm font-semibold text-teal-600"
            : "shrink-0 font-mono text-mono-sm font-semibold text-01"
        }
      >
        {value}
      </p>
    </div>
  );
}

/**
 * No buyer endpoint exposes a tool or provider NAME, so the design's
 * "search_web via prv_searchly" degrades to the ids the wire does give.
 */
function mostlyLabel(r: FailureReason): string {
  if (!r.mostlyToolId) return "—";
  return `${shortId(r.mostlyToolId)}${r.mostlyProviderId ? ` via ${shortId(r.mostlyProviderId)}` : ""}`;
}

export default function GuaranteePage() {
  // Anchored once per mount: a `new Date()` read during render would make the
  // month window a new object on every re-render and refetch forever.
  const anchor = useMemo(() => new Date(), []);
  const { data, loading, error, reload, months, period, onSelectMonth } = useGuarantee(anchor);

  const withheldTotal = data?.withheld?.withheld.amount ?? null;
  const withheldCalls = data?.withheld?.withheld.calls ?? 0;
  const buckets: WithheldBucket[] = data?.withheld?.withheld.buckets ?? [];
  const percent = sharePercent(withheldTotal, data?.listed ?? null);

  const withheldUnavailable = Boolean(data?.withheldError);
  const nothingWithheld =
    !loading && !error && !withheldUnavailable && isZeroMoney(withheldTotal);
  const noCallsAtAll = nothingWithheld && (data?.totalCalls ?? 0) === 0;

  const reasonColumns: TableColumn<FailureReason & { id: string }>[] = [
    { key: "reason", header: "Reason", cell: (r) => r.reason },
    { key: "calls", header: "Calls", width: 90, mono: true, cell: (r) => formatCount(r.calls) },
    {
      key: "amount",
      header: "Amount",
      width: 100,
      mono: true,
      cell: (r) => formatMoney(r.amount, { decimals: 2 }),
    },
    {
      // The design draws this at 300px. At its own 1440 frame that leaves the
      // Reason column ~94px, which truncates every reason string the design
      // itself prints — the frame only looks right because the canvas does not
      // clip text. Narrowed so the column the table is ABOUT stays legible.
      key: "mostly",
      header: "Mostly",
      width: 200,
      mono: true,
      cell: mostlyLabel,
    },
  ];

  const monthColumns: TableColumn<MonthRow & { id: string }>[] = [
    { key: "month", header: "Month", cell: (r) => r.period.label },
    { key: "calls", header: "Calls", width: 90, mono: true, cell: (r) => formatCount(r.calls) },
    {
      key: "listed",
      header: "Listed",
      width: 100,
      mono: true,
      cell: (r) => formatMoney(r.listed),
    },
    {
      key: "charged",
      header: "Charged",
      width: 100,
      mono: true,
      cell: (r) => formatMoney(r.charged),
    },
    {
      // NOT the Table's `notCharged` kind. That column paints teal-600, which
      // is what the Table Bench draws — but the guarantee screen's own By-month table binds
      // `$text-02` here, and this screen's frame is the authority for it.
      key: "notCharged",
      header: "Not charged",
      width: 110,
      mono: true,
      cell: (r) => formatMoney(r.notCharged),
    },
    {
      key: "share",
      header: "%",
      width: 60,
      mono: true,
      cell: (r) => sharePercent(r.notCharged, r.listed) ?? "—",
    },
  ];

  const reasonRows = (data?.reasons ?? []).map((r) => ({ ...r, id: r.reason }));
  const monthRows = (data?.months ?? []).map((m) => ({ ...m, id: m.period.key }));
  const anyMonthHasCalls = monthRows.some((m) => m.calls > 0);

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:px-6 desktop:gap-[18px] desktop:px-7 desktop:py-[22px]">
      <header className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">What we did not charge you for</h1>
          <p className="font-mono text-mono-12 text-03">
            {period.label} · every amount here is a hold we released back to you
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" icon={<Calendar />} aria-label="Change month">
              {period.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border border-01">
            {months.map((m) => (
              <DropdownMenuItem
                key={m.key}
                className="text-body-13"
                onSelect={() => onSelectMonth(m.key)}
              >
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <DisplayAssetSelect />

      {isWalletNotLinked(error) ? <WalletSetupBanner onLinked={reload} /> : null}

      {error && !isWalletNotLinked(error) ? (
        <Banner
          tone="danger"
          title="The guarantee figures could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex w-full items-center rounded-xl border border-teal-20 bg-teal-10 p-6"
        >
          <p className="text-body-md text-02">Loading {period.label}…</p>
        </div>
      ) : null}

      {/* Suppressed when the page-level banner is already saying the same
          thing — two banners carrying one error code reads as two faults. */}
      {data?.withheldError && !error ? (
        <Banner
          tone="danger"
          title="The withheld figure is unavailable for this month"
          description={`${data.withheldError.message}. No figure is shown until it can be read.`}
        />
      ) : null}

      {!loading && !error && noCallsAtAll ? <EmptyState /> : null}

      {!loading && !error && nothingWithheld && !noCallsAtAll ? (
        <section className="flex w-full flex-col gap-1.5 rounded-xl border border-teal-20 bg-teal-10 p-6">
          <h2 className="text-heading-sm text-teal-600">Nothing has been withheld yet</h2>
          <p className="max-w-[720px] text-body-md text-02">
            Nothing has been withheld yet — every call so far passed. When a call fails, you are not
            charged for it and the amount appears here. Refunds are a released hold, so your balance
            never moves; this page is where you see them.
          </p>
        </section>
      ) : null}

      {!loading && !error && !withheldUnavailable && !nothingWithheld ? (
        <section className="flex w-full flex-col items-stretch gap-6 rounded-xl border border-teal-20 bg-teal-10 p-6 desktop:flex-row desktop:items-center desktop:gap-10">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="text-heading-lg text-teal-600">
              {formatMoney(withheldTotal)} not charged, across {formatCount(withheldCalls)} calls
            </p>
            <p className="text-body-md text-02">
              You were billed {formatMoney(data?.charged ?? null)} of{" "}
              {formatMoney(data?.listed ?? null)} worth of calls this month
              {percent ? ` — ${percent} withheld.` : "."}
            </p>
          </div>

          <div className="flex w-full flex-col rounded-lg bg-01 px-[18px] py-4 desktop:w-[520px] desktop:shrink-0">
            {buckets.map((bucket) => {
              const copy = BUCKET_COPY[bucket.bucket];
              return (
                <DecompositionRow
                  key={bucket.bucket}
                  label={copy?.key ?? bucket.label}
                  sub={
                    copy
                      ? `${formatCount(bucket.calls)} calls · ${copy.note}`
                      : `${formatCount(bucket.calls)} calls`
                  }
                  value={formatMoney(bucket.amount)}
                />
              );
            })}
            <DecompositionRow
              total
              label="Total not charged"
              sub={`${formatCount(withheldCalls)} calls · reconciles to the ledger`}
              value={formatMoney(withheldTotal)}
            />
          </div>
        </section>
      ) : null}

      {data?.withheld && !data.withheld.ok ? (
        <Banner
          tone="danger"
          title="This month does not reconcile to the ledger"
          description={`The released holds differ from the withheld total by ${data.withheld.difference}. ${
            data.withheld.orphanedHoldIds.length
          } releases have no matching call. Contact support with this month's statement.`}
        />
      ) : null}

      {data?.freeTier ? (
        <Banner
          tone="primary"
          className="border-01 bg-01"
          icon={<Info className="h-full w-full text-03" />}
          title={`Separately, you made ${formatCount(data.freeTier.calls)} free-tier calls this month, listed at ${formatMoney(data.freeTier.listed)}`}
          description="Those are not counted above — you were never going to be charged for them. Counting them would inflate the guarantee with marketing."
        />
      ) : null}

      {!loading && !error && (reasonRows.length > 0 || anyMonthHasCalls) ? (
        <div className="flex w-full flex-col gap-4 desktop:flex-row">
          {reasonRows.length > 0 ? (
            <Panel className="flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Why calls failed</PanelTitle>
                  <PanelDescription>named reasons, not internal rule ids</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="px-2.5 pb-2.5 pt-1.5">
                {/* Foundations > Breakpoints, row "Tables": at 390 a row becomes
                    a card — name on line 1, figures as label/value pairs below.
                    From 834 the real table scrolls horizontally instead. */}
                <div className="flex flex-col gap-2.5 py-1.5 tablet:hidden">
                  {reasonRows.map((r) => (
                    <CardRow
                      key={r.id}
                      name={r.reason}
                      callsLabel={`${formatCount(r.calls)} calls`}
                      figures={[
                        { label: "Amount", value: formatMoney(r.amount, { decimals: 2 }) },
                      ]}
                      meta={mostlyLabel(r)}
                    />
                  ))}
                </div>
                <div className="hidden w-full overflow-x-auto tablet:block">
                  <Table
                    caption="Why calls failed"
                    className="min-w-[560px]"
                    columns={reasonColumns}
                    rows={reasonRows}
                  />
                </div>
                {!data?.reasonsComplete ? (
                  <p className="px-3 pt-2.5 text-body-xs text-03">
                    Showing the first 1,000 failed calls of this month.
                  </p>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}

          {anyMonthHasCalls ? (
            <Panel className="flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>By month</PanelTitle>
                  <PanelDescription>
                    the trend is the argument — a single month is an anecdote
                  </PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="px-2.5 pb-2.5 pt-1.5">
                <div className="flex flex-col gap-2.5 py-1.5 tablet:hidden">
                  {monthRows.map((m) => (
                    <CardRow
                      key={m.id}
                      name={m.period.label}
                      callsLabel={`${formatCount(m.calls)} calls`}
                      figures={[
                        { label: "Listed", value: formatMoney(m.listed) },
                        { label: "Charged", value: formatMoney(m.charged) },
                        {
                          label: "Not charged",
                          value: formatMoney(m.notCharged),
                          tone: "teal",
                        },
                      ]}
                      meta={`${sharePercent(m.notCharged, m.listed) ?? "—"} withheld`}
                    />
                  ))}
                </div>
                <div className="hidden w-full overflow-x-auto tablet:block">
                  <Table
                    caption="Not charged, by month"
                    className="min-w-[560px]"
                    columns={monthColumns}
                    rows={monthRows}
                  />
                </div>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>How this works</PanelTitle>
            <PanelDescription>
              the one-line version, identical to the tool page and the catalogue
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 p-5">
          <p className="text-body-sm leading-[1.65] text-01">
            Every call is checked for response shape and for result-quality rules — empty results,
            dead links, stale data, missing fields. Those run on every call at every price. Relevance
            is judged on a sample, and backed by the provider&apos;s stake.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="secondary" className="bg-02" icon={<ArrowRight />}>
              Sampling rates by tool
            </Button>
            <Button variant="secondary" className="bg-02" icon={<ArrowRight />}>
              Run a demo
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
