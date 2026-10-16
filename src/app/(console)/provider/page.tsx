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
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { FirstRunCard } from "@/features/provider-home/first-run-card";
import { callPrice } from "@/features/provider-home/format";
import { NeedsActionStrip } from "@/features/provider-home/needs-action-strip";
import { useProviderNeedsAction } from "@/features/provider-home/use-needs-action";
import {
  useListingProgress,
  useProviderBindings,
  useProviderRegistration,
} from "@/features/provider-home/use-listing-progress";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { earningsSplit, homeUnpaidNotes } from "@/features/provider-earnings/earned-tile";
import type { BindingStatus, Money, ProviderEarnings, ToolBindingSummary } from "@/interfaces";
import { routes } from "@/libs/routes";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { getToolBinding } from "@/services/provider-tool-bindings.service";
import { formatMoney, toDecimal } from "@/utils/money";

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

function monthWindow(now: Date) {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function lastDays(now: Date, days: number) {
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() };
}

function byTool(earnings: ProviderEarnings | undefined) {
  return new Map((earnings?.groups ?? []).map((group) => [group.key, group]));
}

export default function ProviderHomePage() {
  const now = React.useMemo(() => new Date(), []);
  const month = React.useMemo(() => monthWindow(now), [now]);
  const recent = React.useMemo(() => lastDays(now, 30), [now]);
  const [stakeOpen, setStakeOpen] = React.useState(false);

  const registration = useProviderRegistration();
  const bindings = useProviderBindings();
  const progress = useListingProgress();
  const stake = useStakeStatus();
  const names = useProviderToolNames();

  const items = React.useMemo(() => bindings.data?.items ?? [], [bindings.data]);
  const live = items.filter((binding) => binding.status === "ACTIVE");

  const earningsMonth = useQuery({
    queryKey: ["provider", "earnings", "tool", month.from, month.to],
    queryFn: () => getProviderEarnings({ ...month, groupBy: "tool" }),
    enabled: items.length > 0,
    retry: false,
  });

  // The first-run listener: polls while a live tool has not served a call yet.
  const recentEarnings = useQuery({
    queryKey: ["provider", "earnings", "tool", "first-call", recent.from],
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

  const { attention, loading: attentionLoading } = useProviderNeedsAction();

  const steps: SetupStep[] = progress.steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    state: step.state,
    optional: step.optional,
    blockedReason: step.blockedReason,
    content:
      step.state === "done" || step.state === "blocked" ? undefined : step.href ? (
        <Button asChild size="sm">
          <Link href={step.href}>{step.actionLabel}</Link>
        </Button>
      ) : (
        <Button size="sm" onClick={() => setStakeOpen(true)}>
          {step.actionLabel}
        </Button>
      ),
  }));

  const subtitle = [
    live.length > 0 ? `${live.length} tool${live.length === 1 ? "" : "s"} live` : null,
    stake.staked && stake.required
      ? `stake ${formatMoney(stake.staked, { decimals: 2 })} of ${formatMoney(stake.required, { decimals: 2 })} needed`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-heading-sm text-01 desktop:text-heading-md">{title}</h1>
          {subtitle ? <p className="text-body-13 text-03 tablet:truncate">{subtitle}</p> : null}
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
            description="Six short steps from here to a tool buyers' agents can call. Each one ticks itself when it is done."
            steps={steps}
            loading={progress.loading}
          />
        )
      ) : (
        <NeedsActionStrip items={attention} onOpenStake={() => setStakeOpen(true)} loading={attentionLoading} />
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
        reason={
          stake.required
            ? `Your paid tools need ${formatMoney(stake.required, { decimals: 2 })} of stake in total.`
            : "Stake backs the failure rate you promise on paid tools."
        }
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
    (money) => formatMoney(money, { decimals: 2 }),
    { money: "/provider/money#passed-not-paid", stake: routes.stake() },
    stakeEnough,
  );
  const value = (money: Money | null) => (money ? toDecimal(money).toNumber() : 0);
  const segments = [
    { label: "In your wallet", value: value(split.inWallet), amount: formatMoney(split.inWallet, { decimals: 2 }), tone: "success" as const },
    split.fee ? { label: "Assay fee", value: value(split.fee), amount: formatMoney(split.fee, { decimals: 2 }), tone: "neutral" as const } : null,
    split.notCredited
      ? {
          label: "Not credited",
          // Not every uncredited call failed the check (API errors and refusals earn nothing too); Money breaks it down by reason.
          note: `${split.notCreditedCalls.toLocaleString("en-US")} call${split.notCreditedCalls === 1 ? "" : "s"} earned nothing; see why in Money`,
          value: value(split.notCredited),
          amount: formatMoney(split.notCredited, { decimals: 2 }),
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
          <span className="font-mono text-heading-md text-01">{formatMoney(split.inWallet, { decimals: 2 })}</span>
        </div>
        {segments.length > 1 ? <MoneySplit segments={segments} /> : null}
        {/* Passed but not in the wallet: open buyer debt (nothing to do) and forfeits (keep the stake up). */}
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
  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Your tools</PanelTitle>
          <PanelDescription>open one for its settings, quality and calls</PanelDescription>
        </PanelTitles>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/provider/bindings">All tools</Link>
        </Button>
      </PanelHeader>
      <PanelBody className="p-2">
        <ul className="flex w-full flex-col">
          {items.map((binding) => {
            const group = groups.get(binding.toolId);
            const href = binding.status === "DRAFT" ? routes.bindingWizard(binding.id) : routes.binding(binding.id);
            return (
              <li key={binding.id}>
                <Link
                  href={href}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <span className="min-w-0 flex-1 basis-40 truncate text-label-13 text-01">{label(binding)}</span>
                  <StatusChip status={BINDING_CHIP[binding.status]} />
                  <span className="w-28 text-right font-mono text-mono-12 text-02">
                    {binding.pricingMode === "FREE" ? "Free" : `${callPrice(binding.price)} / call`}
                  </span>
                  {group ? (
                    <span className="w-36 text-right text-body-xs text-03">
                      {group.calls.toLocaleString("en-US")} calls · {formatMoney(group.earned, { decimals: 2 })}
                    </span>
                  ) : binding.status === "DRAFT" ? (
                    <span className="w-36 text-right text-body-xs text-primary-600">Continue setup</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}
