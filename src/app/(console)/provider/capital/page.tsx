"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpFromLine, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { StakeGauge } from "@/components/provider/stake-gauge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { stakeActionChain, unreadableChains } from "@/features/provider-stake/chain-stake";
import { stakeReason } from "@/features/provider-stake/derivation";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { WithdrawSheet } from "@/features/provider-stake/withdraw-sheet";
import { withdrawStateOf } from "@/features/provider-stake/withdraw-state";
import { useChains } from "@/hooks/useChains";
import { useSearchParam } from "@/hooks/useSearchParam";
import type { ProviderStakeRequirementItem, ToolBindingSummary } from "@/interfaces";
import { routes } from "@/libs/routes";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";

/**
 * Stake — route `/provider/capital` (nav label "Stake").
 *
 * One gauge ("staked / needed / recommended"), one row per tool saying in
 * plain words why it needs what it needs, and two sheets that do everything:
 * Add stake (proves the wallet inside it when needed, then approve + deposit)
 * and Withdraw stake (unbond an amount, then withdraw it). `?sheet=stake` or
 * `?sheet=withdraw` opens one on arrival, so Home, the listing wizard and
 * old `/provider/exit` links land on the action itself.
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
        required: item.minimum ? formatMoney(item.minimum) : "—",
        reason: reasonOf(item),
        grace: item.grace && !item.grace.expired ? item.grace.expiresAt : null,
      };
    }
    if (binding.pricingMode === "FREE") {
      return { id: binding.id, name, required: "$0.00", reason: "free tools need no stake", grace: null };
    }
    return {
      id: binding.id,
      name,
      required: "$0.00",
      reason: binding.status === "DRAFT" ? "not live yet — needs stake when you publish it" : "paused — needs stake again when it resumes",
      grace: null,
    };
  });
  // A requirement for a binding the list did not return still shows.
  for (const item of requirement) {
    if (rows.some((row) => row.id === item.bindingId)) continue;
    rows.push({
      id: item.bindingId,
      name: label({ toolId: item.toolId }),
      required: item.minimum ? formatMoney(item.minimum) : "—",
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
  const penalties = usePenaltySummary();
  const { chains } = useChains();
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

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

  let headline: React.ReactNode;
  if (unreadable && !status.staked) {
    headline = "We could not read your stake from the chain just now. It is safe; try again in a minute.";
  } else if (!status.required) {
    headline = hasStake
      ? "None of your tools needs stake right now. Paid tools will use it when they go live."
      : "You need stake only for paid tools. Free tools can go live without it.";
  } else if (status.enough) {
    headline = `Enough for every paid tool. The recommended ${formatMoney(status.recommended)} leaves room for a penalty without pausing anything.`;
  } else {
    headline = (
      <>
        Short by {formatMoney(status.shortfall)}. Add stake{" "}
        {grace ? (
          <>
            before <LocalTime value={grace.earliestExpiresAt} className="font-semibold" />
          </>
        ) : null}{" "}
        or paid tools above your stake stop taking paid calls.
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

      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
          <StakeGauge staked={status.staked} needed={status.required} recommended={status.recommended} />
          <p className={status.enough === false ? "text-body-13 text-danger-600" : "text-body-13 text-02"}>{headline}</p>
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
                    {withdraw.completesAt ? <LocalTime value={withdraw.completesAt} className="font-semibold text-01" /> : "the end of the waiting period"}.
                  </>
                )}
              </span>
              <Button size="sm" variant={withdraw.phase === "ready" ? "primary" : "ghost"} onClick={() => setSheet("withdraw")}>
                {withdraw.phase === "ready" ? "Withdraw" : "Details"}
              </Button>
            </div>
          ) : null}
          {penalties.count > 0 ? (
            <Link
              href={routes.penalties("needs-action")}
              className="flex items-center gap-2 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700 hover:underline"
            >
              <Scale aria-hidden="true" className="size-4 shrink-0" />
              {penalties.count === 1 ? "1 penalty is" : `${penalties.count} penalties are`} reserving part of this stake. Review
              {penalties.count === 1 ? " it" : " them"} before the deadline.
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
                      Pauses <LocalTime value={row.grace} /> unless stake is added
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
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
