"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpFromLine, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { StakeGauge } from "@/components/provider/stake-gauge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { openPenaltyHold, openPenaltyPhrase } from "@/features/provider-penalties/model";
import { usePenalties } from "@/features/provider-penalties/use-penalties";
import { stakeActionChain, unreadableChains } from "@/features/provider-stake/chain-stake";
import { missingRequirementNote, requiredText, stakeReason } from "@/features/provider-stake/derivation";
import { ProviderPendingTxList } from "@/features/provider-stake/pending-chain-tx-list";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { stakeStatus } from "@/features/provider-stake/stake-status";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { WithdrawSheet } from "@/features/provider-stake/withdraw-sheet";
import { waitingDuration, waitingPeriodOf, withdrawStateOf } from "@/features/provider-stake/withdraw-state";
import { useChains } from "@/hooks/useChains";
import { useSearchParam } from "@/hooks/useSearchParam";
import type { ProviderStakeRequirementItem, ToolBindingSummary } from "@/interfaces";
import { routes } from "@/libs/routes";
import { formatMoney } from "@/utils/money";
import { providerQueries } from "@/features/provider-home/queries";

/**
 * Stake — route `/provider/capital` (nav label "Stake").
 *
 * One gauge ("staked / needed / recommended"), one row per tool saying in
 * plain words why it needs what it needs, and two sheets that do everything:
 * Add stake (proves the wallet inside it when needed, then approve + deposit)
 * and Withdraw stake (unbond an amount, then withdraw it). `?sheet=stake` or
 * `?sheet=withdraw` opens one on arrival, so links from Home and the listing
 * wizard land on the action itself.
 */

interface ToolRow {
  id: string;
  name: string;
  required: string;
  reason: string;
  grace: string | null;
}

function rowsFor(
  bindings: ToolBindingSummary[],
  requirement: ProviderStakeRequirementItem[],
  label: (binding: { toolId: string; endpoint?: string | null }) => string,
  reasonOf: (item: ProviderStakeRequirementItem) => string,
): ToolRow[] {
  const byBinding = new Map(requirement.map((item) => [item.bindingId, item]));
  const rows: ToolRow[] = bindings.map((binding) => {
    const item = byBinding.get(binding.id);
    const name = label(binding);
    if (item) {
      return {
        id: binding.id,
        name,
        required: requiredText(item.minimum),
        reason: reasonOf(item),
        grace: item.grace && !item.grace.expired ? item.grace.expiresAt : null,
      };
    }
    if (binding.pricingMode === "FREE") {
      return { id: binding.id, name, required: "$0.00", reason: "free tools need no stake", grace: null };
    }
    // A paid tool missing from `requirement[]`: no figure is computed for it, and
    // "$0.00" would read as "needs no stake". An ACTIVE one means the read is
    // older than the binding's state (BUG-R16-V3-01), never "paused".
    return {
      id: binding.id,
      name,
      required: "—",
      reason: missingRequirementNote(binding.status),
      grace: null,
    };
  });
  // A requirement for a binding the list did not return still shows.
  for (const item of requirement) {
    if (rows.some((row) => row.id === item.bindingId)) continue;
    rows.push({
      id: item.bindingId,
      name: label({ toolId: item.toolId }),
      required: requiredText(item.minimum),
      reason: reasonOf(item),
      grace: item.grace && !item.grace.expired ? item.grace.expiresAt : null,
    });
  }
  return rows;
}

export default function ProviderStakePage() {
  const router = useRouter();
  const sheetParam = useSearchParam("sheet");
  const status = useStakeStatus();
  const names = useProviderToolNames();
  // The same rows and wording as the Withdraw sheet: every open penalty, disputed ones included.
  const hold = openPenaltyHold(usePenalties({ withCases: "none" }).rows);
  const { chains } = useChains();
  const registration = useQuery(providerQueries.registration());
  const bindings = useQuery(providerQueries.bindings());

  const [sheet, setSheet] = React.useState<"stake" | "withdraw" | null>(null);
  React.useEffect(() => {
    if (sheetParam === "stake" || sheetParam === "withdraw") setSheet(sheetParam);
  }, [sheetParam]);
  const closeSheet = (open: boolean) => {
    if (open) return;
    setSheet(null);
    if (sheetParam) router.replace("/provider/capital");
  };

  if (status.isLoading) return <PageState kind="loading" label="Loading your stake" rows={4} />;
  if (status.isError && !status.stake) {
    return (
      <PageState
        kind="error"
        title="Your stake could not be loaded"
        description="We could not ask Assay for your stake just now. Nothing has changed on chain."
        onRetry={() => void status.refetch()}
      />
    );
  }

  const entry = stakeActionChain(status.stake ?? undefined);
  const withdraw = withdrawStateOf(entry);
  const unreadable = unreadableChains(status.stake ?? undefined).length > 0;
  const rows = rowsFor(
    bindings.data?.items ?? [],
    status.stake?.requirement ?? [],
    names.bindingLabel,
    (item) => stakeReason(item.derivation, chains),
  );
  const grace = status.stake?.graceSummary ?? null;
  const hasStake = Boolean(status.staked && status.staked.amount !== "0");
  const waiting = waitingPeriodOf(withdraw.periodMs, registration.data?.terms);

  const health = stakeStatus(status);
  let headline: React.ReactNode;
  if (unreadable && !status.staked) {
    headline = "We could not read your stake from the chain just now. It is safe; try again in a minute.";
  } else if (!status.required || status.enough) {
    // The same sentence as Home, the Inbox and the Add stake sheet (D21).
    headline = health.sentence;
  } else {
    headline = (
      <>
        {health.sentence}
        {grace ? (
          <>
            {" "}Paid calls continue until <UtcTime value={grace.earliestExpiresAt} className="font-semibold" />, then
            stop on tools above your stake.
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <header className="flex w-full flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Stake</h1>
          <p className="text-body-13 text-03">The deposit that lets your tools take paid calls. It stays yours.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2.5">
          <Button icon={<Plus aria-hidden="true" />} onClick={() => setSheet("stake")}>
            {status.shortfall ? `Add ${formatMoney(status.shortfall)}` : "Add stake"}
          </Button>
          <div className="flex flex-col gap-1">
            <Button
              variant="secondary"
              icon={<ArrowUpFromLine aria-hidden="true" />}
              disabled={!hasStake && withdraw.phase === "none"}
              onClick={() => setSheet("withdraw")}
            >
              {withdraw.phase === "ready" ? `Withdraw ${formatMoney(withdraw.unbonding)}` : "Withdraw"}
            </Button>
            {!hasStake && withdraw.phase === "none" ? (
              <span className="text-body-xs text-03">Nothing staked yet</span>
            ) : null}
          </div>
        </div>
      </header>

      <ProviderPendingTxList kinds={["stake", "unstake", "withdraw"]} />

      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
          <StakeGauge staked={status.staked} needed={status.required} recommended={status.recommended} />
          <p
            className={
              status.enough === false
                ? "text-body-13 text-danger-600"
                : health.health === "close"
                  ? "text-body-13 text-warning-700"
                  : "text-body-13 text-02"
            }
          >
            {headline}
          </p>
          {status.required ? (
            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3 text-body-xs text-02 tablet:grid-cols-2 tablet:gap-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-label-xs text-01">Needed: {formatMoney(status.required)}</dt>
                <dd>
                  The most any one paid tool needs, not the sum. Each paid tool needs its price × 1,000 calls (at least
                  $50.00): enough to cover about 1,000 calls that fail their check.
                </dd>
              </div>
              {status.recommended ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-label-xs text-01">Recommended: {formatMoney(status.recommended)}</dt>
                  <dd>
                    1.5× what is needed. If a penalty takes part of your stake, you stay above what is needed and no tool
                    pauses.
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {withdraw.phase !== "none" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-01 bg-02 px-3.5 py-2.5 text-body-13 text-02">
              <StatusChip status={withdraw.phase === "ready" ? "withdrawable" : "unbonding"} />
              <span className="min-w-0 flex-1">
                {formatMoney(withdraw.unbonding)}{" "}
                {withdraw.phase === "ready" ? (
                  "can go back to your wallet now."
                ) : (
                  <>
                    is unbonding; withdrawable from{" "}
                    {withdraw.completesAt ? <UtcTime value={withdraw.completesAt} className="font-semibold text-01" /> : "the end of the waiting period"}.
                  </>
                )}
              </span>
              <Button size="sm" variant={withdraw.phase === "ready" ? "primary" : "ghost"} onClick={() => setSheet("withdraw")}>
                {withdraw.phase === "ready" ? "Withdraw" : "Details"}
              </Button>
            </div>
          ) : null}
          {hold.count > 0 ? (
            <Link
              href={routes.penalties(hold.needsAction > 0 ? "needs-action" : "disputed")}
              className="flex items-center gap-2 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700 hover:underline"
            >
              <Scale aria-hidden="true" className="size-4 shrink-0" />
              <span>
                {openPenaltyPhrase(hold)} hold {formatMoney(hold.total)} of this stake until they are settled; that part
                cannot be withdrawn.
                {hold.needsAction > 0 ? " Answer the ones that need you before their deadline." : ""}
              </span>
            </Link>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What each tool needs</PanelTitle>
            <PanelDescription className="whitespace-normal">
              Your stake must cover the tool that needs the most, not the sum of all of them.
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-0">
          {bindings.isLoading ? (
            <PageState kind="loading" rows={3} bare className="px-4" />
          ) : rows.length === 0 ? (
            <PageState
              kind="empty"
              bare
              className="px-4 tablet:px-5"
              title="No tools yet"
              description="List a tool first. A free tool needs no stake; a paid one shows what it needs here."
              action={{ label: "List a tool", href: routes.bindingWizard() }}
            />
          ) : (
            <ul className="flex w-full flex-col">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex w-full flex-col gap-1 border-t border-01 px-4 py-3 first:border-t-0 tablet:flex-row tablet:items-center tablet:gap-4 tablet:px-5"
                >
                  <Link href={routes.binding(row.id)} className="min-w-0 flex-1 truncate text-label-13 text-01 hover:underline">
                    {row.name}
                  </Link>
                  <span className="text-body-13 text-02 tablet:text-right">
                    <span className="font-mono text-mono-13 font-semibold text-01">{row.required}</span>
                    {row.required !== "$0.00" ? " because " : " — "}
                    {row.reason}
                  </span>
                  {row.grace ? (
                    <span className="text-body-xs text-danger-600">
                      Pauses <UtcTime value={row.grace} /> unless stake is added
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <Panel id="leaving" className="w-full scroll-mt-20">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Getting your stake back</PanelTitle>
            <PanelDescription className="whitespace-normal">What pausing a tool and withdrawing do, before you do either.</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-13 text-02">
            <li>
              <span className="text-label-13 text-01">Pausing a tool</span> stops agents being sent to it. Calls already
              made stay counted and paid, your stake stays where it is, and there is no penalty for pausing.
            </li>
            <li>
              <span className="text-label-13 text-01">Withdrawing</span> takes two signatures, one on each side of a waiting
              period of {waitingDuration(waiting)}. During it the money stays staked and can still cover penalties for calls
              you already served; after it you withdraw to your wallet.
              {withdraw.completesAt ? (
                <>
                  {" "}Your current withdrawal unlocks{" "}
                  <UtcTime value={withdraw.completesAt} className="font-semibold text-01" />.
                </>
              ) : null}
            </li>
            <li>
              A new withdrawal request restarts the waiting period for everything already waiting. Paid tools that need
              more stake than what remains are paused.
            </li>
            <li>Open penalties hold their amount until they are settled; that part cannot be withdrawn.</li>
          </ul>
          {hasStake || withdraw.phase !== "none" ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              icon={<ArrowUpFromLine aria-hidden="true" />}
              onClick={() => setSheet("withdraw")}
            >
              {withdraw.phase === "ready" ? `Withdraw ${formatMoney(withdraw.unbonding)}` : "Start a withdrawal"}
            </Button>
          ) : null}
        </PanelBody>
      </Panel>

      <p className="text-body-xs text-03">
        Adding stake costs a small network fee in your wallet. A penalty only ever takes stake after its dispute
        deadline, and you can dispute it on the{" "}
        <Link href={routes.penalties()} className="underline">
          Penalties
        </Link>{" "}
        page before then.
      </p>

      <StakeSheet open={sheet === "stake"} onOpenChange={closeSheet} />
      <WithdrawSheet open={sheet === "withdraw"} onOpenChange={closeSheet} />
    </>
  );
}
