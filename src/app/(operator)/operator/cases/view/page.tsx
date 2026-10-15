"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { NextStepCard, type NextStepAction } from "@/components/patterns/next-step-card";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  caseAuthority,
  caseFacts,
  caseNextStep,
  caseTimelineSteps,
  type CaseActionId,
  type CaseStage,
} from "@/features/operator/case-flow";
import { PenaltyMoney } from "@/features/operator/penalty-money";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { suspendedNotice } from "@/features/operator/state";
import { approvalHref, type TwoPersonAnswer } from "@/features/operator/two-person";
import { useProviderNames } from "@/features/operator/use-operator-lookups";
import { CaseContext } from "@/features/provider-slash-case/context";
import { Measurement } from "@/features/provider-slash-case/measurement";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { formatLocalDateTime } from "@/libs/local-time";
import { getArbiterTerms, getOperatorCase } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { CancelSheet } from "./_components/cancel-sheet";
import { MoreActions } from "./_components/more-actions";
import { SuspendSheet } from "./_components/suspend-sheet";

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
 * The off-chain objection controls (claim, decide, second signature, extend
 * the deadline) are gone from the UI: the owner removed that process
 * (business.md #3/#4/#12). [backend] Retiring their endpoints and the sweeper
 * is separate work. Sweep and Compensate stay, under More actions.
 */

const STAGE_CHIP: Record<CaseStage, { status: StatusChipKey; detail?: string }> = {
  "not-on-chain": { status: "waiting", detail: "going on chain" },
  "window-open": { status: "waiting", detail: "dispute window open" },
  executable: { status: "waiting", detail: "executable" },
  disputed: { status: "disputed" },
  upheld: { status: "upheld" },
  "cancel-requested": { status: "needs-action", detail: "cancel to sign" },
  executed: { status: "executed" },
  cancelled: { status: "cancelled" },
};

function BackToPenalties() {
  return (
    <Button variant="ghost" size="sm" asChild className="self-start">
      <Link href="/operator/cases">
        <ArrowLeft aria-hidden="true" />
        Penalties
      </Link>
    </Button>
  );
}

type Result = { title: string; next: string; approvalId?: string; txHash?: string | null };

export default function OperatorCasePage() {
  const proposalId = useSearchParam("id");
  const identity = useOperatorSession();
  const queryClient = useQueryClient();
  const providers = useProviderNames();
  const [sheet, setSheet] = React.useState<"suspend" | "cancel" | null>(null);
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

  const refetch = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "case", proposalId] });
  }, [queryClient, proposalId]);

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
  const next = caseNextStep(facts, authority, (iso) => formatLocalDateTime(iso));
  const providerName = providers.name(proposal.providerId);
  const penaltyText = formatMoney(proposal.penaltyAmount);
  const chip = STAGE_CHIP[facts.stage];

  const actionFor = (id: CaseActionId | null, primary: boolean): NextStepAction | undefined => {
    switch (id) {
      case "suspend":
        return { label: authority.suspend.twoPerson ? "Suspend (needs approval)" : "Suspend penalty", onClick: () => setSheet("suspend"), tone: primary ? "danger" : undefined };
      case "cancel":
        return { label: "Get the cancel signed", onClick: () => setSheet("cancel") };
      case "rule":
        return { label: "Rule on it", href: `/operator/arbiter?case=${encodeURIComponent(proposalId)}` };
      default:
        return undefined;
    }
  };

  const onSuspended = (answer: TwoPersonAnswer<unknown>) => {
    if (answer.kind === "queued") {
      setResult({
        title: "Suspension sent for approval",
        next: "Nothing has happened yet. It runs when a second adjudicator approves it, within 24 h.",
        approvalId: answer.approval.approvalId,
      });
    } else {
      setResult({ title: "Penalty suspended", next: suspendedNotice(brief.chainStatus, proposal.penaltyAmount.asset) });
    }
    refetch();
  };

  return (
    <>
      <BackToPenalties />

      <header className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-heading-sm text-01 tablet:text-heading-md">
            {providerName} · {penaltyText} penalty
          </h1>
          <StatusChip status={chip.status} detail={chip.detail} />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-02">
          <span>
            {proposal.toolName} · {proposal.bindingLabel}
            {proposal.windowLabel ? ` · window ${proposal.windowLabel}` : ""}
          </span>
          <span className="text-03">·</span>
          <span>
            proposed <LocalTime value={proposal.clocks.proposedAt} />
          </span>
          <CopyChip value={proposalId} label="penalty id" />
        </p>
        {facts.legacyStatus ? (
          <p className="text-body-xs text-03">
            Opened under the retired objection process; it now follows the on-chain steps below.
          </p>
        ) : null}
      </header>

      <section aria-label="Where it stands" className="w-full rounded-xl border border-01 bg-01 p-4 tablet:p-5">
        <StatusTimeline
          steps={caseTimelineSteps(brief, facts, { slashDelaySeconds: terms.data?.slashDelaySeconds, now })}
          onElapsed={refetch}
        />
      </section>

      {result ? (
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

      <NextStepCard
        kind={next.kind}
        title={next.title}
        description={next.description}
        action={next.kind === "action" ? actionFor(next.action, true) : undefined}
        secondary={next.secondary ? actionFor(next.secondary, false) : undefined}
      />

      <PenaltyMoney
        penalty={proposal.appliedAmount ?? proposal.penaltyAmount}
        stage={facts.stage}
        executableAt={facts.executableAt}
        agentBps={terms.data?.slashAgentBps ?? null}
      />

      <Tabs defaultValue="measurement" className="flex w-full flex-col gap-4">
        <div className="w-full overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="measurement">Measurement</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="restoration">If cancelled</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="measurement">
          <Measurement data={brief.case} />
        </TabsContent>
        <TabsContent value="context">
          <CaseContext data={brief.case} />
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
                    <LocalTime value={event.occurredAt} className="w-[150px] shrink-0 font-mono text-mono-12 text-03" />
                    <span className="min-w-0 flex-1 text-body-13 text-01">{event.summary}</span>
                    <span className="shrink-0 text-body-xs text-03">
                      {event.actorType === "system" ? "Assay" : event.actorType === "provider" ? "Provider" : (event.actorId ?? "Operator")}
                    </span>
                  </li>
                ))}
            </ol>
          )}
          <p className="pt-3 text-body-13">
            <Link href={`/operator/override-log?targetId=${encodeURIComponent(proposalId)}`} className="text-primary-600 hover:underline">
              Operator actions on this penalty, in Activity
            </Link>
          </p>
        </TabsContent>
        <TabsContent value="restoration">
          {brief.restoration.length === 0 ? (
            <PageState kind="empty" title="Nothing to put back" description="Nothing is recorded as restorable on this penalty." bare />
          ) : (
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
          )}
        </TabsContent>
      </Tabs>

      <MoreActions
        brief={brief}
        proposalId={proposalId}
        identity={identity}
        authority={authority}
        onSuspend={authority.suspend.allowed && next.secondary !== "suspend" ? () => setSheet("suspend") : null}
      />

      {authority.suspend.allowed ? (
        <SuspendSheet
          open={sheet === "suspend"}
          onOpenChange={(open) => setSheet(open ? "suspend" : null)}
          proposalId={proposalId}
          penaltyText={penaltyText}
          twoPerson={authority.suspend.twoPerson}
          me={identity}
          onDone={onSuspended}
        />
      ) : null}
      {authority.cancel ? (
        <CancelSheet
          open={sheet === "cancel"}
          onOpenChange={(open) => setSheet(open ? "cancel" : null)}
          proposalId={proposalId}
          penaltyAsset={proposal.penaltyAmount.asset}
          deadlineText={facts.executableAt ? `before ${formatLocalDateTime(facts.executableAt)}` : "as soon as possible"}
          onSigned={(hash) => {
            setResult({ title: "Cancel sent", next: "The penalty shows as cancelled once the chain watcher reads it back.", txHash: hash });
            refetch();
          }}
        />
      ) : null}
    </>
  );
}
