"use client";

import { ArrowRight, Calendar, ChevronRight, Info } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { DisplayAssetSelect, useDisplayAssetPick } from "@/components/display-asset-select";
import { MoneySplit } from "@/components/patterns/money-flow";
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
import { Table, type TableColumn } from "@/components/ui/table";
import { formatCount, isZeroMoney, sharePercent } from "@/features/buyer/period";
import { useGuarantee, type MonthRow } from "@/features/buyer/use-guarantee";
import { usePublicFeatures } from "@/features/explorer/use-public-explorer";
import { useEntityNames } from "@/hooks/useEntityNames";
import { plain, plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { SUPPORT_URL } from "@/libs/support";
import { isWalletNotLinked } from "@/features/auth/wallet-link";
import type { WithheldBucket } from "@/features/buyer/wire";
import { formatMoney, toDecimal } from "@/utils/money";

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

/**
 * The design writes its own words for the two buckets the API emits; the API's
 * own `label` ("failed verification") is the fallback for a bucket added later,
 * so a new terminal state degrades to plain wording rather than to a blank.
 */
const BUCKET_COPY: Record<string, { key: string; note: string }> = {
  FAILED_VERIFICATION: { key: "Failed our checks", note: "the guarantee" },
  PROVIDER_OR_PLATFORM_ERROR: {
    key: "No usable result",
    note: "a provider or platform error, never charged",
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

export default function GuaranteePage() {
  // Anchored once per mount: a `new Date()` read during render would make the
  // month window a new object on every re-render and refetch forever.
  const anchor = useMemo(() => new Date(), []);
  const assetPick = useDisplayAssetPick();
  const { data, loading, error, reload, months, period, onSelectMonth } = useGuarantee(anchor, 3, assetPick);
  const names = useEntityNames({ kinds: ["tool", "provider"] });
  const { demo } = usePublicFeatures();

  const withheldTotal = data?.withheld?.withheld.amount ?? null;
  const withheldCalls = data?.withheld?.withheld.calls ?? 0;
  const buckets: WithheldBucket[] = data?.withheld?.withheld.buckets ?? [];
  const percent = sharePercent(withheldTotal, data?.listed ?? null);

  const withheldUnavailable = Boolean(data?.withheldError);
  const reconciles = Boolean(data?.withheld?.ok) && !withheldUnavailable;
  const nothingWithheld =
    !loading && !error && !withheldUnavailable && isZeroMoney(withheldTotal);
  const noCallsAtAll = nothingWithheld && (data?.totalCalls ?? 0) === 0;

  const reasonRows = data?.reasons ?? [];
  const monthRows = (data?.months ?? []).map((m) => ({ ...m, id: m.period.key }));
  const anyMonthHasCalls = monthRows.some((m) => m.calls > 0);

  const monthColumns: TableColumn<MonthRow & { id: string }>[] = [
    { key: "month", header: "Month", cell: (r) => r.period.shortLabel ?? r.period.label },
    { key: "calls", header: "Calls", width: 90, mono: true, cell: (r) => formatCount(r.calls) },
    { key: "listed", header: "Listed", width: 100, mono: true, cell: (r) => formatMoney(r.listed) },
    { key: "charged", header: "Charged", width: 100, mono: true, cell: (r) => formatMoney(r.charged) },
    { key: "notCharged", header: "Not charged", width: 110, mono: true, cell: (r) => formatMoney(r.notCharged) },
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
            What our checks refused to charge you for in {period.label}. Each amount was held, then released back to
            you.
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
          description={plainError(error.code)}
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
          <h2 className="text-heading-sm text-teal-600">Every call this month passed</h2>
          <p className="max-w-[720px] text-body-md text-02">
            When a call fails our checks, you are not charged and the amount appears here. Your balance never moves for
            it: the money was only held, then released.
          </p>
        </section>
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
                segments={[
                  { label: "Charged", value: toDecimal(charged).toNumber(), amount: formatMoney(charged), tone: "primary" },
                  { label: "Not charged", value: toDecimal(withheldTotal).toNumber(), amount: formatMoney(withheldTotal), tone: "teal" },
                ]}
              />
            ) : null}
          </div>

          <div className="flex w-full flex-col rounded-lg bg-01 px-[18px] py-4 desktop:w-[440px] desktop:shrink-0">
            {buckets.map((bucket) => {
              const copy = BUCKET_COPY[bucket.bucket];
              return (
                <DecompositionRow
                  key={bucket.bucket}
                  label={copy?.key ?? bucket.label}
                  sub={`${formatCount(bucket.calls)} ${bucket.calls === 1 ? "call" : "calls"}${copy ? ` · ${copy.note}` : ""}`}
                  value={formatMoney(bucket.amount)}
                />
              );
            })}
            <DecompositionRow
              total
              label="Total not charged"
              sub={`${formatCount(withheldCalls)} ${withheldCalls === 1 ? "call" : "calls"}${reconciles ? " · matches your balance history exactly" : ""}`}
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

      {data?.withheld && !data.withheld.ok && !withheldUnavailable ? (
        <section role="alert" className="flex w-full flex-col gap-3 rounded-xl border border-warning-20 bg-warning-10 p-4 tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-label-sm text-warning-700">This month&apos;s figures do not add up yet</p>
            <p className="text-body-13 text-02">
              The released holds differ from the not-charged total by{" "}
              {formatMoney({ ...data.withheld.holdReleaseTotal, amount: data.withheld.difference.replace(/^-/, "") })}.
              Your money is not affected; keep this month&apos;s statement for reference.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/statements?month=${period.key}`}>Download statement</Link>
            </Button>
            {SUPPORT_URL ? (
              <Button variant="secondary" size="sm" asChild>
                <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
                  Contact support
                </a>
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

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

      {!loading && !error && (reasonRows.length > 0 || anyMonthHasCalls) ? (
        <div className="flex w-full flex-col gap-4 desktop:flex-row desktop:items-start">
          {reasonRows.length > 0 ? (
            <Panel className="flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Why calls were not charged</PanelTitle>
                  <PanelDescription>Open one to see those calls</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody>
                <ul className="flex flex-col">
                  {reasonRows.map((r) => (
                    <li key={r.reason} className="border-b border-01 last:border-b-0">
                      <Link
                        href={routes.calls({ status: "not-charged", tool: r.mostlyToolId ?? undefined })}
                        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-body-sm text-01">{plain(r.reason)}</span>
                          <span className="text-body-xs text-03">
                            {formatCount(r.calls)} {r.calls === 1 ? "call" : "calls"}
                            {r.mostlyToolId ? ` · mostly ${names.name("tool", r.mostlyToolId)}` : ""}
                            {names.lookup("provider", r.mostlyProviderId) ? ` from ${names.lookup("provider", r.mostlyProviderId)}` : ""}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-mono-13 font-semibold text-teal-600">
                          {formatMoney(r.amount, { decimals: 2 })}
                        </span>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {!data?.reasonsComplete ? (
                  <p className="px-5 py-2.5 text-body-xs text-03">Showing the first 1,000 failed calls of this month.</p>
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
                      ]}
                      meta={`${sharePercent(m.notCharged, m.listed) ?? "—"} not charged`}
                    />
                  ))}
                </div>
                <div className="hidden w-full overflow-x-auto tablet:block">
                  <Table caption="Not charged, by month" className="min-w-[560px]" columns={monthColumns} rows={monthRows} />
                </div>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

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
