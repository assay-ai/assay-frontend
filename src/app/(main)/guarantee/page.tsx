"use client";

import { ArrowRight, Calendar, ChevronRight, Info } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo } from "react";

import { DisplayAssetSelect, useDisplayAssetPick } from "@/components/display-asset-select";
import { ApiErrorSentence } from "@/components/patterns/api-error-sentence";
import { plainError } from "@/libs/plain-language";
import { MoneySplit, type MoneyTone } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";

import { WalletSetupBanner } from "@/components/auth/wallet-setup-banner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { CardRow } from "@/components/ui/card-row";
import { OwedSummaryAction } from "@/features/buyer-debt/owed-row-action";
import { Table, type TableColumn } from "@/components/ui/table";
import { nothingWithheldHeading, notRunSentence, partOfLine } from "@/features/buyer/guarantee-copy";
import { listedSplit, notChargedLines, type ListedSplitSegment } from "@/features/buyer/not-charged";
import { formatCount, isZeroMoney, sharePercent } from "@/features/buyer/period";
import { MATCHES_SENTENCE, ReconcileNote } from "@/features/buyer/reconcile-note";
import { useGuarantee, type FailureReason, type MonthRow } from "@/features/buyer/use-guarantee";
import { usePublicFeatures } from "@/features/explorer/use-public-explorer";
import { useEntityNames } from "@/hooks/useEntityNames";
import { routes } from "@/libs/routes";
import { SUPPORT_URL } from "@/libs/support";
import { isWalletNotLinked } from "@/features/auth/wallet-link";
import { formatMoney } from "@/utils/money";
import { useChainTerms } from "@/hooks/useChainTerms";

/**
 * Activity › Not charged (route `/guarantee`) — "prove the guarantee works for me".
 *
 * The product's claim is invisible by construction: a refund here is a hold
 * being released, so it never appears as a line on a statement and the balance
 * never moves. This screen is the only place the claim becomes a figure, which
 * is why every number on it is stated by the API rather than inferred here, and
 * why the page header carries the identity it can be checked against
 * (`withheld == Σ HOLD_RELEASE`).
 *
 * Listed = charged + not charged is drawn as one bar; each reason is a plain
 * sentence that opens Calls filtered to not-charged calls; the reconcile line
 * shows only when every source answered and agreed.
 */

/** The bar's colour per summary bucket. */
const SPLIT_TONE: Record<ListedSplitSegment["key"], MoneyTone> = {
  charged: "primary",
  "not-charged": "teal",
  owed: "warning",
  "in-progress": "neutral",
};

function plural(n: number, one: string): string {
  return `${formatCount(n)} ${n === 1 ? one : `${one}s`}`;
}

/** One row of "Why calls were not charged": a line of the split, or a reason nested under it. */
function ReasonRow({
  href,
  label,
  sub,
  amount,
  nested = false,
}: {
  href: string;
  label: string;
  sub: string;
  amount: string;
  nested?: boolean;
}) {
  return (
    <li className="border-b border-01 last:border-b-0">
      <Link
        href={href}
        className={
          (nested ? "pl-8 tablet:pl-10 " : "") +
          "flex w-full items-center gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
        }
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={nested ? "text-body-13 text-02" : "text-label-sm text-01"}>{label}</span>
          <span className="text-body-xs text-03">{sub}</span>
        </div>
        <span className="shrink-0 font-mono text-mono-13 font-semibold text-teal-600">{amount}</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
      </Link>
    </li>
  );
}

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

export default function GuaranteePage() {
  const { terms: chainTerms } = useChainTerms();
  // Anchored once per mount: a `new Date()` read during render would make the
  // month window a new object on every re-render and refetch forever.
  const anchor = useMemo(() => new Date(), []);
  const assetPick = useDisplayAssetPick();
  const { data, loading, error, reload, months, period, onSelectMonth } = useGuarantee(anchor, 3, assetPick);
  const names = useEntityNames({ kinds: ["tool", "provider"] });
  const { demo } = usePublicFeatures();

  const withheldTotal = data?.withheld?.withheld.amount ?? null;
  const withheldCalls = data?.withheld?.withheld.calls ?? 0;
  // The three lines of "not charged", the same on Overview, Spend and Statements.
  const lines = notChargedLines(data?.withheld);
  const percent = sharePercent(withheldTotal, data?.listed ?? null);
  // Listed = charged + not charged + owed + in progress, each a share of listed.
  const split = listedSplit({
    listed: data?.listed ?? null,
    charged: data?.charged ?? null,
    notCharged: data?.notCharged ?? withheldTotal,
    owed: data?.owed ?? null,
    inProgress: data?.inProgress ?? null,
  });

  const withheldUnavailable = Boolean(data?.withheldError);
  const reconciles = Boolean(data?.withheld?.ok) && !withheldUnavailable;
  const nothingWithheld =
    !loading && !error && !withheldUnavailable && isZeroMoney(withheldTotal);
  const noCallsAtAll = nothingWithheld && (data?.totalCalls ?? 0) === 0;

  const reasonRows = data?.reasons ?? [];
  const reasonsOf = (bucket: string): FailureReason[] => reasonRows.filter((r) => r.bucket === bucket);
  const reasonLines = lines.filter((line) => line.calls > 0 || reasonsOf(line.bucket).length > 0);
  const monthRows = (data?.months ?? []).map((m) => ({ ...m, id: m.period.key }));
  const anyMonthHasCalls = monthRows.some((m) => m.calls > 0);

  const monthColumns: TableColumn<MonthRow & { id: string }>[] = [
    { key: "month", header: "Month", cell: (r) => r.period.shortLabel ?? r.period.label },
    { key: "calls", header: "Calls", width: 90, mono: true, cell: (r) => formatCount(r.calls) },
    { key: "listed", header: "Listed", width: 100, mono: true, cell: (r) => formatMoney(r.listed) },
    { key: "charged", header: "Charged", width: 100, mono: true, cell: (r) => formatMoney(r.charged) },
    { key: "notCharged", header: "Not charged", width: 110, mono: true, cell: (r) => formatMoney(r.notCharged) },
    // Buyer debt (served, payment not collected) and calls still running: only
    // when some month has any, so the table stays narrow otherwise.
    ...(monthRows.some((r) => !isZeroMoney(r.owed))
      ? [{ key: "owed", header: "Owed", width: 90, mono: true, cell: (r: MonthRow) => formatMoney(r.owed) }]
      : []),
    ...(monthRows.some((r) => !isZeroMoney(r.inProgress))
      ? [{ key: "inProgress", header: "In progress", width: 100, mono: true, cell: (r: MonthRow) => formatMoney(r.inProgress) }]
      : []),
    { key: "share", header: "Share", width: 70, mono: true, cell: (r) => sharePercent(r.notCharged, r.listed) ?? "—" },
  ];

  const listed = data?.listed ?? null;
  const charged = data?.charged ?? null;

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:px-6 desktop:gap-[18px] desktop:px-7 desktop:py-[22px]">
      <header className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Not charged</h1>
          <p className="text-body-13 text-03">
            What you were not charged for in {period.label}: calls that failed our checks, had no usable result, or
            were never collected. Each amount was held, then released back to you.
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" icon={<Calendar />} aria-label={`Month: ${period.label}. Change month`}>
              {period.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border border-01">
            {months.map((m) => (
              <DropdownMenuItem key={m.key} className="text-body-13" onSelect={() => onSelectMonth(m.key)}>
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <DisplayAssetSelect live />

      {isWalletNotLinked(error) ? <WalletSetupBanner onLinked={reload} /> : null}

      {error && !isWalletNotLinked(error) ? (
        <PageState
          kind="error"
          title="These figures could not be loaded"
          description={<ApiErrorSentence error={error} fallback={plainError(undefined)} />}
          onRetry={reload}
          code={error.code}
          details={error.message}
        />
      ) : null}

      {loading ? <PageState kind="loading" rows={4} label={`Loading ${period.label}`} /> : null}

      {data?.withheldError && !error ? (
        <PageState
          kind="error"
          title="The not-charged total is unavailable for this month"
          description="We show no figure until it can be read."
          onRetry={reload}
          code={data.withheldError.code}
          details={data.withheldError.message}
        />
      ) : null}

      {!loading && !error && noCallsAtAll ? (
        <PageState
          kind="empty"
          title="No calls this month"
          description="When your agent calls a paid tool, any call that fails our checks is not charged and shows up here."
          action={{ label: "Connect your agent", href: "/connect" }}
        />
      ) : null}

      {!loading && !error && nothingWithheld && !noCallsAtAll ? (
        <section className="flex w-full flex-col gap-1.5 rounded-xl border border-teal-20 bg-teal-10 p-5 tablet:p-6">
          <h2 className="text-heading-sm text-teal-600">{nothingWithheldHeading(data?.notRunCalls ?? 0)}</h2>
          <p className="max-w-[720px] text-body-md text-02">
            When a call fails our checks, you are not charged and the amount appears here. Your balance never moves for
            it: the money was only held, then released.
          </p>
        </section>
      ) : null}

      {/* Owed is not the guarantee's doing (a payment not collected): its own line, with the way out. */}
      {!loading && !error && data?.owed && !isZeroMoney(data.owed) ? (
        <OwedSummaryAction owed={formatMoney(data.owed)} calls={data.owedCalls || null} />
      ) : null}

      {!loading && !error && !withheldUnavailable && !nothingWithheld ? (
        <section className="flex w-full flex-col items-stretch gap-6 rounded-xl border border-teal-20 bg-teal-10 p-5 tablet:p-6 desktop:flex-row desktop:items-start desktop:gap-10">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-heading-lg text-teal-600">
                {formatMoney(withheldTotal)} not charged, across {formatCount(withheldCalls)}{" "}
                {withheldCalls === 1 ? "call" : "calls"}
              </p>
              <p className="text-body-md text-02">
                You paid {formatMoney(charged)} for {formatMoney(listed)} worth of calls
                {percent ? ` — ${percent} was not charged.` : "."}
              </p>
            </div>
            {listed && charged && withheldTotal ? (
              <MoneySplit
                className="rounded-lg bg-01 p-4"
                total={{ label: "Listed price of your calls", amount: formatMoney(listed) }}
                // Shares are of listed, at the sentence's precision, not of the bar's own segments.
                showPercent={false}
                segments={split.map((segment) => ({
                  label: segment.label,
                  value: segment.value,
                  amount: formatMoney(segment.amount),
                  tone: SPLIT_TONE[segment.key],
                  note: segment.percent ?? undefined,
                }))}
              />
            ) : null}
          </div>

          <div className="flex w-full flex-col rounded-lg bg-01 px-[18px] py-4 desktop:w-[440px] desktop:shrink-0">
            {lines.map((line) => (
              <DecompositionRow
                key={line.bucket}
                label={line.label}
                sub={`${plural(line.calls, "call")}${line.note ? ` · ${line.note}` : ""}`}
                value={formatMoney(line.amount)}
              />
            ))}
            <DecompositionRow
              total
              label="Total not charged"
              sub={`${formatCount(withheldCalls)} ${withheldCalls === 1 ? "call" : "calls"}${reconciles ? ` · ${MATCHES_SENTENCE.replace(/\.$/, "").toLowerCase()}` : ""}`}
              value={formatMoney(withheldTotal)}
            />
            <Link
              href={routes.calls({ status: "not-charged" })}
              className="mt-3 inline-flex items-center gap-1 self-start text-label-13 text-primary-600 hover:underline"
            >
              See these calls
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </section>
      ) : null}

      {!loading && !error && !withheldUnavailable ? <ReconcileNote withheld={data?.withheld} /> : null}

      {data?.freeTier ? (
        <p className="flex items-start gap-2 text-body-13 text-02">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
          <span>
            Separately, you made {formatCount(data.freeTier.calls)} free-tier {data.freeTier.calls === 1 ? "call" : "calls"}{" "}
            this month, listed at {formatMoney(data.freeTier.listed)}. They are not counted above: you were never going
            to be charged for them.
          </span>
        </p>
      ) : null}

      {!loading && !error && data && data.notRunCalls > 0 ? (
        <p className="flex items-start gap-2 text-body-13 text-02" data-testid="guarantee-not-run">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
          <span>{notRunSentence(data.notRunCalls, data.notRunComplete)}</span>
        </p>
      ) : null}

      {!loading && !error && (reasonLines.length > 0 || anyMonthHasCalls) ? (
        <div className="flex w-full flex-col gap-4 desktop:flex-row desktop:items-start">
          {reasonLines.length > 0 ? (
            <Panel className="flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Why calls were not charged</PanelTitle>
                  <PanelDescription>Open one to see those calls</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody>
                {/* The same three lines as the card above; each call's reason sits under its line. */}
                <ul className="flex flex-col">
                  {reasonLines.map((line) => {
                    const nested = reasonsOf(line.bucket);
                    // The line's count comes from GET /withheld; the reasons below are the calls at hand.
                    const showNested = nested.length > 0;
                    return (
                      <Fragment key={line.bucket}>
                        <ReasonRow
                          href={routes.calls({ status: "not-charged" })}
                          label={line.label}
                          sub={`${plural(line.calls, "call")}${line.note ? ` · ${line.note}` : ""}`}
                          amount={formatMoney(line.amount, { decimals: 2 })}
                        />
                        {showNested
                          ? nested.map((r) => (
                              <ReasonRow
                                key={`${line.bucket}|${r.reason}`}
                                nested
                                href={routes.calls({ status: "not-charged", tool: r.mostlyToolId ?? undefined })}
                                label={r.label}
                                sub={
                                  partOfLine(r.calls, line.calls) +
                                  (r.mostlyToolId ? ` · mostly ${names.name("tool", r.mostlyToolId)}` : "") +
                                  (names.lookup("provider", r.mostlyProviderId)
                                    ? ` from ${names.lookup("provider", r.mostlyProviderId)}`
                                    : "")
                                }
                                amount={formatMoney(r.amount, { decimals: 2 })}
                              />
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </ul>
                {!data?.reasonsComplete ? (
                  <p className="px-5 py-2.5 text-body-xs text-03">Built from the first 1,000 calls of this month.</p>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}

          {anyMonthHasCalls ? (
            <Panel className="flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>By month</PanelTitle>
                  <PanelDescription>How it has gone over the last three months</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="px-2.5 pb-2.5 pt-1.5">
                <div className="flex flex-col gap-2.5 py-1.5 tablet:hidden">
                  {monthRows.map((m) => (
                    <CardRow
                      key={m.id}
                      name={m.period.label}
                      callsLabel={`${formatCount(m.calls)} ${m.calls === 1 ? "call" : "calls"}`}
                      figures={[
                        { label: "Listed", value: formatMoney(m.listed) },
                        { label: "Charged", value: formatMoney(m.charged) },
                        { label: "Not charged", value: formatMoney(m.notCharged), tone: "teal" },
                        ...(isZeroMoney(m.owed) ? [] : [{ label: "Owed", value: formatMoney(m.owed) }]),
                        ...(isZeroMoney(m.inProgress) ? [] : [{ label: "In progress", value: formatMoney(m.inProgress) }]),
                      ]}
                      meta={`${sharePercent(m.notCharged, m.listed) ?? "—"} not charged`}
                    />
                  ))}
                </div>
                <div className="hidden w-full overflow-x-auto tablet:block">
                  <Table
                    caption="Not charged, by month"
                    className={monthColumns.length > 7 ? "min-w-[720px]" : "min-w-[560px]"}
                    columns={monthColumns}
                    rows={monthRows}
                  />
                </div>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <section
        aria-labelledby="guarantee-coverage"
        className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-5"
      >
        <h2 id="guarantee-coverage" className="text-label-md text-01">
          What the guarantee covers
        </h2>
        <div className="grid w-full grid-cols-1 gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-label-13 text-teal-600">The guarantee: not charged</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-body-13 text-02">
              <li>A result that fails our checks, including one in the wrong format.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-label-13 text-01">Also not charged</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-body-13 text-02">
              <li>No usable result: the provider errored, rejected the request or never answered.</li>
              <li>Not collected: the call was served, but the payment was not taken.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-label-13 text-01">Not covered: charged</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-body-13 text-02">
              <li>A result that passes our checks but is still not what you needed.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-label-13 text-01">How to report a bad result</h3>
            <p className="text-body-13 text-02">
              Open the call and choose Report a bad result. On chains with the {chainTerms.holdCompound} hold, a charge
              is refundable for {chainTerms.holdWindow} if your report is accepted; the call&apos;s receipt says whether this one still is. Otherwise
              there is no refund, but your report counts against the provider&apos;s quality and can lead to a
              penalty on their stake.
            </p>
            <Link
              href={routes.disputes()}
              className="inline-flex items-center gap-1 self-start text-label-13 text-primary-600 hover:underline"
            >
              Your reports
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <section className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-5">
        <h2 className="text-label-md text-01">How this works</h2>
        <p className="text-body-sm leading-[1.65] text-02">
          Every call is checked for its response shape and the tool&apos;s quality rules — empty results, dead links,
          stale data, missing fields — at every price. Some tools also check relevance on a sample of calls, backed by
          the provider&apos;s <Term k="stake">stake</Term>.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" icon={<ArrowRight />} asChild>
            <Link href="/explore">See what each tool checks</Link>
          </Button>
          {demo ? (
            <Button variant="secondary" icon={<ArrowRight />} asChild>
              <Link href="/demo">Watch it refuse to charge</Link>
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
