"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { UtcTime } from "@/components/patterns/utc-time";
import { NextStepCard, type NextStepAction } from "@/components/patterns/next-step-card";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cancelDeadlineSentence,
  caseAuthority,
  caseFacts,
  caseNextStep,
  caseTimelineSteps,
  pendingRequestStep,
  type CaseActionId,
  type CaseStage,
  type PendingRequest,
} from "@/features/operator/case-flow";
import { approvalNeeds, approvalTargetId, approveBlockedBecause, isOwnRequest, penaltyPhrase } from "@/features/operator/approvals";
import { eligibleApprovers, isLiveApproval } from "@/features/operator/inbox";
import { OperatorMeasurement } from "@/features/operator/operator-measurement";
import { PENALTY_APPROVAL_CODES } from "@/features/operator/penalty-list";
import { keptShareText, PenaltyMoney, stakeReduction } from "@/features/operator/penalty-money";
import { reasonLabel } from "@/features/operator/reasons";
import { rememberRecentPenalty } from "@/features/operator/recent-penalties";
import { rulingHref } from "@/features/operator/ruling-link";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { suspendedNotice } from "@/features/operator/state";
import { approvalHref, sentForApproval, type TwoPersonAnswer } from "@/features/operator/two-person";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import { CaseContext } from "@/features/provider-slash-case/context";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { formatDateTime } from "@/libs/utc-time";
import type { OperatorCaseBrief } from "@/interfaces/operator";
import { getArbiterTerms, getOperatorCase, listApprovals } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { nothingStandingOutcome } from "@/features/operator/operator-errors";

import { CancelSheet } from "./_components/cancel-sheet";
import { MoreActions } from "./_components/more-actions";
import { SuspendSheet } from "./_components/suspend-sheet";
import { WhyNotLine } from "./_components/why-not-line";

/**
 * A penalty, route `/operator/cases/view?id=`.
 *
 * Built for the on-chain process the product now runs: a status timeline
 * (Proposed → dispute window → [disputed → arbiter rules] → executed or
 * cancelled) with the next date counting down, then ONE card with the single
 * thing this operator can do — or who it is waiting for, and until when.
 * The money is drawn, with the split read from the chain's current terms.
 * The evidence, the context, the history and the restoration are tabs.
 *
 * Two columns from 1280px: the timeline, the money and the tabs on the left;
 * the next step and the key facts in a sticky side column, so the action
 * stays in view while the tabs are read. The one primary action lives in that
 * next-step card only (never repeated in the header, at any width); the rare
 * actions (suspend, block, pay back, sweep, history) sit in the header's ⋯
 * menu, never at the bottom. A two-person request already waiting on the
 * penalty becomes the next step: approve it, or who it waits for.
 *
 * The off-chain objection controls (claim, decide, second signature, extend
 * the deadline) are gone from the UI: the owner removed that process
 * (business.md #3/#4/#12). [backend] Retiring their endpoints and the sweeper
 * is separate work.
 */

const STAGE_CHIP: Record<CaseStage, { status: StatusChipKey; detail?: string }> = {
  "not-on-chain": { status: "waiting", detail: "going on chain" },
  "window-open": { status: "waiting", detail: "dispute window open" },
  executable: { status: "waiting", detail: "executable" },
  disputed: { status: "disputed" },
  upheld: { status: "upheld" },
  "cancel-requested": { status: "waiting-signature", detail: "cancel" },
  executed: { status: "executed" },
  compensated: { status: "closed", detail: "paid back" },
  cancelled: { status: "cancelled" },
};

const WAITING_WHAT: Record<string, string> = {
  "slash.suspend": "A suspension of this penalty",
  "slash.compensated": "A pay-back of this penalty",
  "slash.sweep": "A fleet sweep from this penalty",
};

/** Instants in sentences always carry their day, in running-text case ("before today 18:41"). */
const when = (iso: string) => formatDateTime(iso, { alwaysDay: true, midSentence: true });

/** "If cancelled" only says something while the penalty can still be cancelled. */
const RESTORATION_STAGES: readonly CaseStage[] = ["not-on-chain", "window-open", "executable", "disputed", "upheld", "cancel-requested"];

function showsRestoration(stage: CaseStage, brief: OperatorCaseBrief, expired: boolean): boolean {
  return !expired && RESTORATION_STAGES.includes(stage) && brief.restoration.length > 0;
}

/** Stages where the stake will not go down: nothing to say about by how much. */
const MOVES_NOTHING: readonly CaseStage[] = ["cancelled", "cancel-requested", "compensated"];

function BackToPenalties() {
  return (
    <Button variant="ghost" size="sm" asChild className="touch-target self-start">
      <Link href="/operator/cases">
        <ArrowLeft aria-hidden="true" />
        Penalties
      </Link>
    </Button>
  );
}

type Result = { title: string; next: string; approvalId?: string; txHash?: string | null; approvers?: string[]; expiresAt?: string; alert?: boolean };

export default function OperatorCasePage() {
  const proposalId = useSearchParam("id");
  const identity = useOperatorSession();
  const queryClient = useQueryClient();
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  const [sheet, setSheet] = React.useState<"suspend" | "cancel" | "close" | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const caseQuery = useQuery({
    queryKey: ["operator", "case", proposalId],
    queryFn: () => getOperatorCase(proposalId),
    enabled: proposalId !== "",
    retry: 0,
  });
  const brief = caseQuery.data;
  const penaltyAsset = brief?.case.proposal.penaltyAmount.asset ?? "";
  const chainId = penaltyAsset.startsWith("eip155:") ? (penaltyAsset.split("/")[0] ?? null) : null;
  const terms = useQuery({
    queryKey: ["operator", "arbiter", "terms", chainId],
    queryFn: () => getArbiterTerms(chainId!),
    enabled: chainId !== null,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  // A suspension of this penalty already waiting for approval — the same query as the badge.
  const pending = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  // Waiting means what Approvals means by it: pending and not past its deadline (`isLiveApproval`).
  const live = (pending.data?.items ?? []).filter((a) => isLiveApproval(a, now) && approvalTargetId(a) === proposalId);
  const waitingSuspend = live.find((a) => a.action === "slash.suspend") ?? null;
  // Any two-person request on this penalty (suspend, pay back, sweep) is said once, above the columns.
  const waitingAny = waitingSuspend ?? live.find((a) => a.action in PENALTY_APPROVAL_CODES) ?? null;

  // After an action, everything on the page is read again: status, next step, history.
  const refetch = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "case", proposalId] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "override-log"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "arbiter", "disputes"] });
  }, [queryClient, proposalId]);

  // Remembered in this browser, so a penalty nobody disputed can be found again from Penalties.
  const loaded = caseQuery.data?.case.proposal;
  const loadedName = loaded && !providers.isPending ? penaltyPhrase(providers.name(loaded.providerId), formatMoney(loaded.penaltyAmount)) : null;
  React.useEffect(() => {
    if (!loaded || !loadedName) return;
    rememberRecentPenalty({ id: loaded.id, providerId: loaded.providerId, label: loadedName, at: new Date().toISOString() });
  }, [loaded, loadedName]);

  if (!proposalId) {
    return (
      <>
        <BackToPenalties />
        <PageState kind="empty" title="No penalty chosen" description="Open a penalty from Home or from Penalties." action={{ label: "Go to Penalties", href: "/operator/cases" }} />
      </>
    );
  }

  if (caseQuery.isError) {
    const error = caseQuery.error;
    // An unknown id and another organisation's case answer the same 404, on purpose.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <BackToPenalties />
        {notFound ? (
          <PageState kind="empty" title="No such penalty" description="Check the link, or find the penalty from Home or Penalties." />
        ) : (
          <PageState
            kind="error"
            description="The penalty could not be loaded."
            onRetry={() => void caseQuery.refetch()}
            code={error instanceof ApiError ? error.code : null}
            details={error instanceof Error ? error.message : null}
          />
        )}
      </>
    );
  }

  if (!brief) {
    return (
      <>
        <BackToPenalties />
        <PageState kind="loading" rows={5} label="Loading the penalty" />
      </>
    );
  }

  const proposal = brief.case.proposal;
  const facts = caseFacts(brief, now);
  const authority = caseAuthority(brief, identity, facts);
  const baseNext = caseNextStep(facts, authority, when);
  // A request already waiting on this penalty is the next step, unless this operator has an action of their own.
  const pendingRequest: PendingRequest | null = waitingAny
    ? {
        action: waitingAny.action,
        requestedBy: directory.nameOf(waitingAny.requestedBy),
        createdAt: waitingAny.createdAt,
        expiresAt: waitingAny.expiresAt,
        mine: isOwnRequest(waitingAny, identity),
        canApprove: !isOwnRequest(waitingAny, identity) && approveBlockedBecause(waitingAny, identity) === null,
        approvers: directory.isPending
          ? []
          : eligibleApprovers(PENALTY_APPROVAL_CODES[waitingAny.action] ?? "", directory.operators, waitingAny.requestedById),
      }
    : null;
  const pendingInCard = pendingRequest !== null && baseNext.kind !== "action";
  const next = pendingInCard ? pendingRequestStep(pendingRequest, when, now) : baseNext;
  const providerName = providers.name(proposal.providerId);
  const penaltyText = formatMoney(proposal.penaltyAmount);
  const penaltyName = penaltyPhrase(providerName, penaltyText);
  const suspendApprovers = directory.isPending ? undefined : eligibleApprovers("S-1", directory.operators, identity.id);
  const chip = facts.expired ? { status: "expired" as const } : STAGE_CHIP[facts.stage];

  const actionFor = (id: CaseActionId | null, primary: boolean): NextStepAction | undefined => {
    switch (id) {
      case "suspend":
        return { label: authority.suspend.twoPerson ? "Suspend (needs approval)" : "Suspend penalty", onClick: () => setSheet("suspend"), tone: primary ? "danger" : undefined };
      case "cancel":
        return { label: "Get the cancel signed", onClick: () => setSheet("cancel") };
      case "close-chain":
        return { label: "Confirm and close", onClick: () => setSheet("close") };
      case "approve":
        return waitingAny ? { label: "Review and approve", href: approvalHref(waitingAny.id) } : undefined;
      case "open-request":
        return waitingAny ? { label: "Open the request", href: approvalHref(waitingAny.id) } : undefined;
      default:
        return undefined;
    }
  };

  const onSuspended = (answer: TwoPersonAnswer<unknown>, reasonCode: string) => {
    if (answer.kind === "queued") {
      const sent = sentForApproval(`Suspending ${penaltyName}`, suspendApprovers, approvalNeeds("S-1", identity.roles), answer.approval.expiresAt);
      setResult({
        ...sent,
        approvalId: answer.approval.approvalId,
        approvers: suspendApprovers,
        expiresAt: answer.approval.expiresAt,
      });
    } else {
      setResult({
        title: `${penaltyName.charAt(0).toUpperCase()}${penaltyName.slice(1)} is suspended (${reasonLabel(reasonCode)})`,
        next: suspendedNotice(brief.chainStatus, proposal.penaltyAmount.asset),
      });
    }
    refetch();
  };

  // Ruling is neutral: Cancel and Uphold carry equal weight, each opening its sheet on the Arbiter.
  const ruling = next.kind === "action" && next.action === "rule";
  const primary = next.kind === "action" && !ruling ? actionFor(next.action, true) : undefined;
  const reduction = stakeReduction(proposal.appliedAmount ?? proposal.penaltyAmount, terms.data?.slashAgentBps ?? null, true);
  const readOnlyRuling = facts.stage === "disputed" && !authority.rule;
  const restoration = showsRestoration(facts.stage, brief, facts.expired);
  const pendingActions = live.map((a) => a.action);

  return (
    <>
      <BackToPenalties />

      <header className="flex w-full min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 text-heading-sm text-01 tablet:text-heading-md">
              {providerName} · {penaltyText} penalty
            </h1>
            <StatusChip status={chip.status} detail={chip.detail} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-02">
            <span>{proposal.toolName || "Penalty"}</span>
            <span aria-hidden="true" className="text-03">·</span>
            <span>
              proposed <UtcTime value={proposal.clocks.proposedAt} midSentence />
            </span>
            <span aria-hidden="true" className="text-03">·</span>
            <CopyChip value={proposalId} label="penalty id" />
          </p>
          {facts.legacyStatus ? (
            <p className="text-body-xs text-03">Opened under the retired objection process; it now follows the on-chain steps below.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <MoreActions
            brief={brief}
            proposalId={proposalId}
            identity={identity}
            authority={authority}
            penaltyName={penaltyName}
            pendingActions={pendingActions}
            onSuspend={authority.suspend.allowed ? () => setSheet("suspend") : null}
          />
        </div>
      </header>

      {result?.alert ? (
        <div role="alert" className="flex w-full flex-col gap-1 rounded-lg border border-danger-20 bg-danger-10 p-3.5">
          <p className="text-label-13 text-danger-700">{result.title}</p>
          <p className="text-body-13 text-02">{result.next}</p>
        </div>
      ) : result ? (
        <ResultCard
          tone={result.approvalId ? "queued" : "done"}
          title={result.title}
          next={result.next}
          link={result.approvalId ? { label: "Open the request", href: approvalHref(result.approvalId) } : null}
          activityHref={result.approvalId ? null : `/operator/override-log?targetId=${encodeURIComponent(proposalId)}`}
          txUrl={result.txHash && chainId && stakeDeploymentFor(chainId) ? explorerTxLink(stakeDeploymentFor(chainId)!, result.txHash) : null}
          onDismiss={() => setResult(null)}
        />
      ) : null}

      {waitingAny && !pendingInCard && !result?.approvalId ? (
        <p role="status" className="w-full rounded-lg border border-01 bg-02 px-3.5 py-2.5 text-body-13 text-01">
          {WAITING_WHAT[waitingAny.action] ?? "A request on this penalty"} is waiting for approval: {directory.nameOf(waitingAny.requestedBy)} asked{" "}
          <UtcTime value={waitingAny.createdAt} midSentence />.{" "}
          <Link href={approvalHref(waitingAny.id)} className="hit-area text-primary-700 underline-offset-2 hover:underline">
            Open the request
          </Link>
        </p>
      ) : null}

      <div className="grid w-full min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] xl:gap-5">
        <section aria-label="Where it stands" className="w-full min-w-0 rounded-xl border border-01 bg-01 p-4 tablet:p-5 xl:col-start-1 xl:row-start-1">
          <StatusTimeline
            steps={caseTimelineSteps(brief, facts, { slashDelaySeconds: terms.data?.slashDelaySeconds, now })}
            onElapsed={refetch}
            alwaysDay
          />
        </section>

        <aside className="flex w-full min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:self-start">
          {next.alert ? (
            <p role="alert" className="w-full rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-label-13 text-danger-700">
              {next.title}: the stake was taken.
            </p>
          ) : null}
          <NextStepCard
            layout="stack"
            kind={next.kind}
            title={next.title}
            description={next.description}
            meta={next.meta ?? undefined}
            action={primary}
            secondary={next.secondary ? actionFor(next.secondary, false) : undefined}
            footer={
              ruling ? (
                <div className="flex w-full flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
                  <Button variant="secondary" asChild className="touch-target w-full sm:w-auto">
                    <Link href={rulingHref(proposalId, "CANCEL")} aria-label={`Cancel ${penaltyName}`}>
                      Cancel
                    </Link>
                  </Button>
                  <Button variant="secondary" asChild className="touch-target w-full sm:w-auto">
                    <Link href={rulingHref(proposalId, "UPHOLD")} aria-label={`Uphold ${penaltyName}`}>
                      Uphold
                    </Link>
                  </Button>
                </div>
              ) : readOnlyRuling ? (
                <WhyNotLine action="rule" me={identity} ask={`Can you rule on ${penaltyName}? The provider disputed it on chain.`} />
              ) : undefined
            }
          />
          <dl className="flex w-full flex-col rounded-xl border border-01 bg-01 text-body-13">
            <Fact label="Provider">
              <Link
                href={`/operator/cases?tab=all&q=${encodeURIComponent(providerName)}`}
                className="hit-area inline-flex items-center gap-1 text-01 underline-offset-2 hover:underline"
              >
                {providerName}
                <ArrowRight aria-hidden="true" className="size-3.5 text-03" />
              </Link>
            </Fact>
            <Fact label="Tool">{proposal.bindingLabel || proposal.toolName}</Fact>
            {reduction && terms.data && (facts.stage === "executed" || !MOVES_NOTHING.includes(facts.stage)) ? (
              <Fact
                label={facts.stage === "executed" ? "Taken from the stake" : facts.stage === "upheld" ? "Taken from the stake when it executes" : "Taken from the stake if upheld"}
                hint={`The agents' and the platform's shares. The provider's ${keptShareText(terms.data.slashAgentBps)} is never taken.`}
              >
                {formatMoney(reduction)}
              </Fact>
            ) : null}
            <Fact label="Proposed">
              <UtcTime value={proposal.clocks.proposedAt} />
            </Fact>
            {brief.upheldViolations30d ? (
              <Fact label="Other penalties upheld" hint="Against this provider in the last 30 days.">
                {brief.upheldViolations30d}
              </Fact>
            ) : null}
          </dl>
        </aside>

        <div className="w-full min-w-0 xl:col-start-1 xl:row-start-2">
          <PenaltyMoney penalty={proposal.appliedAmount ?? proposal.penaltyAmount} stage={facts.stage} agentBps={terms.data?.slashAgentBps ?? null} />
        </div>

        <Tabs defaultValue="measurement" className="flex w-full min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-3">
          <div className="w-full overflow-x-auto">
            <TabsList className="min-w-max">
              <TabsTrigger value="measurement" className="touch-target">Measurement</TabsTrigger>
              <TabsTrigger value="context" className="touch-target">Context</TabsTrigger>
              <TabsTrigger value="history" className="touch-target">History</TabsTrigger>
              {restoration ? <TabsTrigger value="restoration" className="touch-target">If cancelled</TabsTrigger> : null}
            </TabsList>
          </div>
          <TabsContent value="measurement">
            <OperatorMeasurement data={brief.case} />
          </TabsContent>
          <TabsContent value="context">
            <CaseContext data={brief.case} audience="operator" />
          </TabsContent>
          <TabsContent value="history">
            {brief.timeline.length === 0 ? (
              <PageState kind="empty" title="Nothing has happened yet" bare />
            ) : (
              <ol className="flex w-full flex-col rounded-xl border border-01 bg-01">
                {[...brief.timeline]
                  .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
                  .map((event) => (
                    <li key={event.id} className="flex w-full flex-col gap-0.5 border-b border-01 px-4 py-3 last:border-b-0 tablet:flex-row tablet:gap-4">
                      <UtcTime value={event.occurredAt} className="w-[150px] shrink-0 text-body-xs text-03" />
                      <span className="min-w-0 flex-1 text-body-13 text-01">{event.summary}</span>
                      <span className="shrink-0 text-body-xs text-03">
                        {event.actorType === "system" ? "Assay" : event.actorType === "provider" ? "Provider" : directory.nameOf(event.actorId)}
                      </span>
                    </li>
                  ))}
              </ol>
            )}
            <p className="pt-3 text-body-13">
              <Link href={`/operator/override-log?targetId=${encodeURIComponent(proposalId)}`} className="hit-area text-primary-700 underline-offset-2 hover:underline">
                Operator actions on this penalty, in Activity
              </Link>
            </p>
          </TabsContent>
          {restoration ? (
            <TabsContent value="restoration">
              <dl className="flex w-full flex-col rounded-xl border border-01 bg-01">
                {brief.restoration.map((row) => (
                  <div key={row.label} className="flex w-full flex-col gap-0.5 border-b border-01 px-4 py-3 last:border-b-0 tablet:flex-row tablet:gap-4">
                    <dt className="w-[160px] shrink-0 text-body-13 text-03">{row.label}</dt>
                    <dd className="min-w-0 flex-1 text-body-13 text-01">{row.value}</dd>
                    <span className="shrink-0 text-body-xs text-03">
                      {row.status === "RESTORED" ? "put back" : row.status === "ON_DECISION" ? "if cancelled" : "not affected"}
                    </span>
                  </div>
                ))}
              </dl>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      {authority.suspend.allowed ? (
        <SuspendSheet
          open={sheet === "suspend"}
          onOpenChange={(open) => setSheet(open ? "suspend" : null)}
          proposalId={proposalId}
          penaltyText={penaltyText}
          twoPerson={authority.suspend.twoPerson}
          me={identity}
          waiting={waitingSuspend}
          onDone={onSuspended}
        />
      ) : null}
      {authority.cancel || authority.closeChain ? (
        <CancelSheet
          mode={authority.closeChain ? "close" : "sign"}
          open={sheet === "cancel" || sheet === "close"}
          onOpenChange={(open) => setSheet(open ? (authority.closeChain ? "close" : "cancel") : null)}
          proposalId={proposalId}
          penaltyAsset={proposal.penaltyAmount.asset}
          deadlineSentence={cancelDeadlineSentence(facts, when)}
          onNothingStanding={(error) => {
            // Say what the backend's chain read showed (and whether it closed anything), then read the penalty again.
            setSheet(null);
            setResult(nothingStandingOutcome(error));
            refetch();
          }}
          onSigned={(hash) => {
            setResult({ title: "Cancel sent", next: "The penalty shows as cancelled once the chain watcher reads it back.", txHash: hash });
            refetch();
          }}
        />
      ) : null}
    </>
  );
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 border-b border-01 px-4 py-2.5 last:border-b-0">
      <dt className="text-03">{label}</dt>
      <dd className="truncate text-right tabular-nums text-01">{children}</dd>
      {hint ? <dd className="col-span-2 text-body-xs text-03">{hint}</dd> : null}
    </div>
  );
}
