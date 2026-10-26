"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { MoneySplit } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import { SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { PROVIDER_EXPLAINER } from "@/components/layout/provider-nav-config";
import { foldDrafts, priceLine } from "@/features/provider-binding/listing-copy";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { FirstRunCard } from "@/features/provider-home/first-run-card";
import { NeedsActionStrip, WatchList } from "@/features/provider-home/needs-action-strip";
import { useProviderNeedsAction } from "@/features/provider-home/use-needs-action";
import {
  useListingProgress,
  useProviderBindings,
  useProviderRegistration,
} from "@/features/provider-home/use-listing-progress";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { stakeStatus } from "@/features/provider-stake/stake-status";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { earningsSplit, homeUnpaidNotes } from "@/features/provider-earnings/earned-tile";
import { providerMoney } from "@/features/provider-earnings/not-credited";
import type { BindingStatus, Money, ProviderEarnings, ToolBindingSummary } from "@/interfaces";
import { routes } from "@/libs/routes";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { getToolBinding } from "@/services/provider-tool-bindings.service";
import { toDecimal } from "@/utils/money";
import { earningsKey, last30DaysWindow, monthWindow } from "@/features/provider-home/report-windows";

/**
 * Provider home — "what do I do next?" in five seconds.
 *
 *  - Not live yet: the "Get listed" checklist (Account, Wallet, First tool,
 *    Test, Stake for paid tools, Live), each step with its one action. The
 *    shell shows the same progress as a pill on every other page.
 *  - Live: a "Needs action" strip (penalties with countdowns, windows past
 *    half of the promised failure rate, a short stake, a suspended tool), the
 *    first-run "Your tool is live" card until the first call lands, this
 *    month's earnings, and the tools by name.
 *
 * Nothing is shown as "—": a figure with no source is left out.
 */

const BINDING_CHIP: Record<BindingStatus, StatusChipKey> = {
  DRAFT: "draft",
  ACTIVE: "live",
  PAUSED: "paused",
  SUSPENDED: "blocked",
};

function byTool(earnings: ProviderEarnings | undefined) {
  return new Map((earnings?.groups ?? []).map((group) => [group.key, group]));
}

export default function ProviderHomePage() {
  const now = React.useMemo(() => new Date(), []);
  const month = React.useMemo(() => monthWindow(now), [now]);
  // The same 30-day window Portfolio asks about, so the two share one request.
  const recent = React.useMemo(() => last30DaysWindow(now), [now]);
  const [stakeOpen, setStakeOpen] = React.useState(false);

  const registration = useProviderRegistration();
  const bindings = useProviderBindings();
  const progress = useListingProgress();
  const stake = useStakeStatus();
  const names = useProviderToolNames();

  const items = React.useMemo(() => bindings.data?.items ?? [], [bindings.data]);
  const live = items.filter((binding) => binding.status === "ACTIVE");

  const earningsMonth = useQuery({
    queryKey: earningsKey(month),
    queryFn: () => getProviderEarnings({ ...month, groupBy: "tool" }),
    enabled: items.length > 0,
    retry: false,
  });

  // The first-run listener: polls while a live tool has not served a call yet.
  const recentEarnings = useQuery({
    queryKey: earningsKey(recent),
    queryFn: () => getProviderEarnings({ ...recent, groupBy: "tool" }),
    enabled: live.length > 0,
    retry: false,
    refetchInterval: (query) => ((query.state.data?.totals.calls ?? 0) === 0 ? 15_000 : false),
  });
  const callsSoFar = recentEarnings.data ? recentEarnings.data.totals.calls : null;
  const firstLive = live[0] ?? null;
  const firstLiveDetail = useQuery({
    queryKey: ["provider", "tool-binding", firstLive?.id],
    queryFn: () => getToolBinding(firstLive!.id),
    enabled: Boolean(firstLive) && callsSoFar === 0,
  });
  // Keep the card up for the moment the first call lands, then retire it on the next visit.
  const [sawWaiting, setSawWaiting] = React.useState(false);
  React.useEffect(() => {
    if (callsSoFar === 0) setSawWaiting(true);
  }, [callsSoFar]);
  const showFirstRun = Boolean(firstLive) && (callsSoFar === 0 || (sawWaiting && (callsSoFar ?? 0) > 0));

  const record = registration.data?.registration;
  const title = record?.legalName ?? "Welcome";

  const { attention, watch, loading: attentionLoading } = useProviderNeedsAction();

  const steps: SetupStep[] = progress.steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    state: step.state,
    optional: step.optional,
    blockedReason: step.blockedReason,
    content:
      step.state === "done" || step.state === "blocked" ? undefined : step.href ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={step.href}>{step.actionLabel}</Link>
          </Button>
          {/* An equal choice, not a fallback: same weight as the first button. */}
          {step.secondary ? (
            <Button asChild size="sm">
              <Link href={step.secondary.href}>{step.secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <Button size="sm" onClick={() => setStakeOpen(true)}>
          {step.actionLabel}
        </Button>
      ),
  }));

  // One stake status for Home, Stake, the Inbox and the Add stake sheet (D21).
  const stakeHealth = stakeStatus(stake);
  const subtitle = [
    live.length > 0 ? `${live.length} tool${live.length === 1 ? "" : "s"} live` : null,
    stake.staked && stake.required && stakeHealth.label
      ? `stake ${providerMoney(stake.staked)} · ${stakeHealth.label} (${providerMoney(stake.required)} minimum)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Stacked below tablet: in a wrapping row, `flex-1` (basis 0) never
          wrapped, so at 390px the name and status shrank to a ~60px column
          beside the buttons (V1-10). */}
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:flex-wrap tablet:items-center tablet:justify-between" data-testid="provider-home-header">
        <div className="flex w-full min-w-0 flex-col gap-0.5 tablet:w-auto tablet:flex-1">
          <h1 className="truncate text-heading-sm text-01 desktop:text-heading-md">{title}</h1>
          {subtitle ? <p className="text-body-13 text-03 tablet:truncate">{subtitle}</p> : null}
          <Link href={PROVIDER_EXPLAINER.href} className="inline-flex min-h-10 items-center self-start text-body-13 text-primary-600 hover:underline">
            {PROVIDER_EXPLAINER.label}
          </Link>
        </div>
        {record ? (
          <div className="flex flex-wrap items-center gap-2">
            {live.length > 0 ? (
              <Button asChild variant="secondary">
                <a href={routes.publicProvider(record.id)} target="_blank" rel="noreferrer">
                  How buyers see you
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={routes.bindingWizard()}>
                <Plus aria-hidden="true" />
                List a tool
              </Link>
            </Button>
          </div>
        ) : null}
      </header>

      {!progress.live ? (
        bindings.isError && registration.isError && !progress.loading ? (
          <PageState
            kind="error"
            description="Your setup progress could not be loaded."
            onRetry={() => {
              void registration.refetch();
              void bindings.refetch();
            }}
          />
        ) : (
          <SetupChecklist
            title="Get listed"
            description="Five short steps from here to a tool buyers' agents can call, plus an optional stake. Each one ticks itself when it is done."
            steps={steps}
            loading={progress.loading}
          />
        )
      ) : (
        <>
          <NeedsActionStrip items={attention} onOpenStake={() => setStakeOpen(true)} loading={attentionLoading} />
          <WatchList items={watch} />
        </>
      )}

      {showFirstRun && firstLive ? (
        <FirstRunCard
          bindingId={firstLive.id}
          toolName={names.bindingLabel(firstLive)}
          providerName={record?.legalName ?? null}
          binding={firstLiveDetail.data ?? null}
          calls={callsSoFar}
        />
      ) : null}

      {items.length > 0 ? (
        <EarningsPanel earnings={earningsMonth.data} loading={earningsMonth.isLoading} stakeEnough={stake.isLoading ? null : stake.enough} />
      ) : null}

      {items.length > 0 ? (
        <ToolsPanel items={items} earnings={earningsMonth.data} label={names.bindingLabel} />
      ) : null}

      <StakeSheet
        open={stakeOpen}
        onOpenChange={setStakeOpen}
        amount={stake.shortfall}
        reason={stake.required ? stakeHealth.sentence : "Stake backs the failure rate you promise on paid tools."}
        onStaked={() => void stake.refetch()}
      />
    </>
  );
}

function EarningsPanel({
  earnings,
  loading,
  stakeEnough,
}: {
  earnings: ProviderEarnings | undefined;
  loading: boolean;
  /** Whether the stake covers the minimum now; null while unknown. */
  stakeEnough: boolean | null;
}) {
  if (loading) return <PageState kind="loading" rows={2} label="Loading this month's earnings" />;
  const totals = earnings?.totals;
  if (!totals) return null;
  const split = earningsSplit(totals);
  const unpaidNotes = homeUnpaidNotes(
    totals,
    providerMoney,
    { money: "/provider/money#passed-not-paid", stake: routes.stake() },
    stakeEnough,
  );
  const value = (money: Money | null) => (money ? toDecimal(money).toNumber() : 0);
  const segments = [
    { label: "In your wallet", value: value(split.inWallet), amount: providerMoney(split.inWallet), tone: "success" as const },
    split.fee ? { label: "Assay fee", value: value(split.fee), amount: providerMoney(split.fee), tone: "neutral" as const } : null,
    split.notCredited
      ? {
          label: "Not credited",
          // Not every uncredited call failed the check (API errors and refusals earn nothing too); Money breaks it down by reason.
          note: `${split.notCreditedCalls.toLocaleString("en-US")} call${split.notCreditedCalls === 1 ? "" : "s"} earned nothing; see why in Money`,
          value: value(split.notCredited),
          amount: providerMoney(split.notCredited),
          tone: "danger" as const,
        }
      : null,
  ].filter((segment): segment is NonNullable<typeof segment> => segment !== null);

  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>This month</PanelTitle>
          <PanelDescription>
            {totals.calls.toLocaleString("en-US")} call{totals.calls === 1 ? "" : "s"} · paid on chain as calls settle
          </PanelDescription>
        </PanelTitles>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/provider/money">See money</Link>
        </Button>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-body-13 text-02">In your wallet this month</span>
          <span className="font-mono text-heading-md text-01">{providerMoney(split.inWallet)}</span>
        </div>
        {segments.length > 1 ? <MoneySplit segments={segments} /> : null}
        {/* Passed but not in the wallet: the same lines as Money (buyer debt, never collected, forfeits). */}
        {unpaidNotes.length > 0 ? (
          <ul className="flex flex-col gap-1.5" data-testid="provider-home-unpaid">
            {unpaidNotes.map((note) => {
              const Icon = note.tone === "warning" ? TriangleAlert : Info;
              return (
                <li
                  key={note.key}
                  className={`flex items-start gap-1.5 text-body-xs ${note.tone === "warning" ? "text-warning-700" : "text-03"}`}
                >
                  <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span>
                    {note.text}{" "}
                    <Link href={note.link.href} className="font-medium underline underline-offset-2">
                      {note.link.label}
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function ToolsPanel({
  items,
  earnings,
  label,
}: {
  items: ToolBindingSummary[];
  earnings: ProviderEarnings | undefined;
  label: (binding: ToolBindingSummary) => string;
}) {
  const groups = byTool(earnings);
  // Live first; drafts fold into one row, so they never push a live listing down.
  const { shown, drafts } = foldDrafts(items);
  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Your listings</PanelTitle>
          <PanelDescription>open one for its settings, quality and calls</PanelDescription>
        </PanelTitles>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/provider/bindings">All listings</Link>
        </Button>
      </PanelHeader>
      <PanelBody className="p-2">
        <ul className="flex w-full flex-col">
          {shown.map((binding) => {
            const group = groups.get(binding.toolId);
            return (
              <li key={binding.id}>
                <Link
                  href={routes.binding(binding.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <span className="min-w-0 flex-1 basis-40 truncate text-label-13 text-01">{label(binding)}</span>
                  <StatusChip status={BINDING_CHIP[binding.status]} />
                  <span className="w-36 text-right text-body-13 text-02">{priceLine(binding)}</span>
                  {group ? (
                    <span className="w-36 text-right text-body-xs text-03">
                      {group.calls.toLocaleString("en-US")} calls · {providerMoney(group.earned)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          {drafts.length > 0 ? (
            <li>
              <Link
                href={drafts.length === 1 ? routes.bindingWizard(drafts[0]!.id) : "/provider/bindings"}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="min-w-0 flex-1 basis-40 truncate text-label-13 text-01">
                  {drafts.length === 1 ? `Draft: ${label(drafts[0]!)}` : `Drafts (${drafts.length})`}
                </span>
                <StatusChip status="draft" />
                <span className="w-36 text-right text-body-xs text-primary-600">Continue setup</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </PanelBody>
    </Panel>
  );
}
