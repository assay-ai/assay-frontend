"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, HelpCircle, Scale, Wallet } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { MoneySplit } from "@/components/patterns/money-flow";
import { WalletActionSheet } from "@/components/patterns/sign-action";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Measurement } from "@/features/provider-slash-case/measurement";
import { SLASH_AGENT_BPS, SLASH_PLATFORM_BPS, splitPenalty } from "@/features/provider-slash-case/distribution";
import { DEMO_SIGNING_NOTE } from "@/features/provider-stake/wallet-readiness";
import { formatRemaining, useCountdown } from "@/hooks/useCountdown";
import type { Money } from "@/interfaces";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { getSlaWindow } from "@/services/provider-sla-windows.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { DISPUTE_TIMEOUT_DAYS, describeDisputeError } from "./dispute";
import { lossBasis, lossOf, penaltyTimeline, type PenaltyRow } from "./model";
import { failureSentence } from "./sentences";

/* ── small pieces ─────────────────────────────────────────────────────── */

export function statusKeyOf(row: PenaltyRow, nowSeconds: number): StatusChipKey {
  if (row.tab === "closed") return row.closedAs === "executed" ? "executed" : row.closedAs === "expired" ? "expired" : "cancelled";
  if (row.tab === "disputed") return "disputed";
  if (row.upheld) return "upheld";
  return row.canDispute || nowSeconds * 1000 < Date.parse(row.executableAt) ? "needs-action" : "waiting";
}

/** The window a penalty is about, as a date range ("Oct 13, 15:00 – Oct 14, 15:00"). */
export function useWindowRange(windowId: string | null | undefined) {
  return useQuery({
    queryKey: ["provider", "sla-window", windowId],
    queryFn: () => getSlaWindow(windowId!),
    enabled: Boolean(windowId),
    retry: 0,
    staleTime: 5 * 60_000,
  });
}

export function WindowRange({ windowId, className }: { windowId: string | null | undefined; className?: string }) {
  const window = useWindowRange(windowId);
  if (!windowId) return null;
  if (!window.data) return <span className={cn("text-03", className)}>Measurement window</span>;
  return (
    <span className={className}>
      Window <LocalTime value={window.data.openedAt} /> – <LocalTime value={window.data.closedAt ?? window.data.deadlineAt} />
    </span>
  );
}

/** The one date that matters for this row, with a live countdown when it is a deadline. */
export function DeadlineChip({ row }: { row: PenaltyRow }) {
  const target = row.canDispute ? row.executableAt : row.tab === "disputed" ? row.arbiterTargetAt : null;
  const { msLeft } = useCountdown(target);
  const urgent = row.canDispute && msLeft !== null && msLeft < 24 * 3_600_000;
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-xs";
  if (row.canDispute) {
    return (
      <span className={cn(base, urgent ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700")}>
        <Clock aria-hidden="true" className="size-3" />
        Dispute within {msLeft === null ? "…" : formatRemaining(msLeft)}
        {row.executableAt ? (
          <>
            {" "}· by <LocalTime value={row.executableAt} withZone />
          </>
        ) : null}
      </span>
    );
  }
  if (row.tab === "disputed") {
    return (
      <span className={cn(base, "bg-primary-10 text-primary-700")}>
        Arbiter aims to rule by {row.arbiterTargetAt ? <LocalTime value={row.arbiterTargetAt} dateOnly /> : "7 days after the dispute"}
      </span>
    );
  }
  if (row.tab === "needs-action") {
    return (
      <span className={cn(base, "bg-danger-10 text-danger-700")}>
        Can be executed from <LocalTime value={row.executableAt} withZone />
      </span>
    );
  }
  return null;
}

/**
 * The number a provider reads first is what leaves their stake, not the gross
 * penalty: 90% of it is taken, the rest is never touched.
 */
export function HeadlineAmount({ row }: { row: PenaltyRow }) {
  const loss = lossOf(row);
  if (!loss) {
    return <span className="font-mono text-mono-13 text-03 line-through">{formatMoney(row.amount)}</span>;
  }
  const executed = row.closedAs === "executed";
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-body-13 text-02">{executed ? "You lost" : "You would lose"}</span>
      <span className="font-mono text-mono-13 font-semibold text-01">{formatMoney(loss)}</span>
      <span className="text-body-xs text-03">of a {formatMoney(lossBasis(row))} penalty</span>
    </span>
  );
}

/* ── the row ──────────────────────────────────────────────────────────── */

export function PenaltyRowCard({
  row,
  detail,
  nowSeconds,
  onWhy,
  onDispute,
  disputeBlocked,
  onConnect,
}: {
  row: PenaltyRow;
  detail: SlashProposalCaseDetail | null;
  nowSeconds: number;
  onWhy: () => void;
  onDispute: () => void;
  /** Why Dispute cannot be pressed, shown next to it. */
  disputeBlocked: string | null;
  /** Set when the only thing missing is the stake wallet: offer to connect it instead of a dead button. */
  onConnect?: () => void;
}) {
  const toolName = detail?.proposal.toolName ?? null;
  return (
    <li className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-label-md text-01">{toolName ?? (row.proposalId ? "Loading…" : "Penalty")}</span>
          <StatusChip status={statusKeyOf(row, nowSeconds)} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-13 text-02">
          <HeadlineAmount row={row} />
          {detail?.proposal.windowId ? <WindowRange windowId={detail.proposal.windowId} /> : null}
          {row.tab === "closed" ? (
            <span className="text-03">
              {row.closedAs === "executed" ? "Taken from your stake" : row.closedAs === "expired" ? "Expired, nothing taken" : "Cancelled, nothing taken"}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeadlineChip row={row} />
          {!row.proposalId && row.tab === "needs-action" ? (
            <span className="text-body-xs text-warning-700">Assay has no case for this penalty — check it.</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1 tablet:items-end">
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<HelpCircle aria-hidden="true" />} onClick={onWhy}>
            Why this penalty?
          </Button>
          {row.canDispute ? (
            disputeBlocked && onConnect ? (
              <Button size="sm" icon={<Wallet aria-hidden="true" />} onClick={onConnect}>
                Connect stake wallet
              </Button>
            ) : (
              <Button size="sm" icon={<Scale aria-hidden="true" />} onClick={onDispute} disabled={Boolean(disputeBlocked)}>
                Dispute
              </Button>
            )
          ) : null}
        </div>
        {row.canDispute && disputeBlocked ? (
          <span className="max-w-[18rem] text-body-xs text-03 tablet:text-right">{disputeBlocked}</span>
        ) : null}
      </div>
    </li>
  );
}

/* ── money ────────────────────────────────────────────────────────────── */

export function LossSentence({ row }: { row: PenaltyRow }) {
  if (row.closedAs === "cancelled" || row.closedAs === "expired") {
    return <p className="text-body-13 text-02">Nothing was taken from your stake.</p>;
  }
  const basis: Money = lossBasis(row);
  const split = splitPenalty(basis);
  const executed = row.closedAs === "executed";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-13 text-01">
        {executed ? "Of this " : "If it is executed, of this "}
        {formatMoney(basis)} penalty <span className="font-semibold">{formatMoney(split.taken)}</span>{" "}
        {executed ? "left" : "leaves"} your stake: {formatMoney(split.agent)} to the buyers whose calls failed and{" "}
        {formatMoney(split.platform)} to Assay. The other {formatMoney(split.neverTaken)} is never taken.
      </p>
      <MoneySplit
        segments={[
          { label: "To the buyers whose calls failed", value: SLASH_AGENT_BPS, amount: formatMoney(split.agent), tone: "teal" },
          { label: "To Assay", value: SLASH_PLATFORM_BPS, amount: formatMoney(split.platform), tone: "indigo" },
          {
            label: "Never taken (stays in your stake)",
            value: 10_000 - SLASH_AGENT_BPS - SLASH_PLATFORM_BPS,
            amount: formatMoney(split.neverTaken),
            tone: "neutral",
          },
        ]}
      />
      <p className="text-body-xs text-03">
        Split under the current terms ({SLASH_AGENT_BPS / 100}% / {SLASH_PLATFORM_BPS / 100}% /{" "}
        {(10_000 - SLASH_AGENT_BPS - SLASH_PLATFORM_BPS) / 100}%). The chain applies the terms in force when it executes.
      </p>
    </div>
  );
}

/* ── the "Why?" drawer ────────────────────────────────────────────────── */

export function PenaltyDrawer({
  row,
  detail,
  nowSeconds,
  onOpenChange,
  onDispute,
  disputeBlocked,
  onConnect,
}: {
  row: PenaltyRow | null;
  detail: SlashProposalCaseDetail | null;
  nowSeconds: number;
  onOpenChange: (open: boolean) => void;
  onDispute: () => void;
  disputeBlocked: string | null;
  onConnect?: () => void;
}) {
  const open = row !== null;
  const toolName = detail?.proposal.toolName ?? null;
  const failures = detail?.failuresByRule ?? [];
  const totalFailures = failures.reduce((sum, f) => sum + f.count, 0);
  const topAgent = [...(detail?.failuresByAgent ?? [])].sort((a, b) => b.count - a.count)[0];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[640px]">
        {row ? (
          <>
            <SheetHeader className="tablet:pt-5">
              <SheetTitle className="pr-8">{toolName ? `Why ${toolName} got a penalty` : "Why this penalty"}</SheetTitle>
              <SheetDescription>
                {lossOf(row) ? `${row.closedAs === "executed" ? "You lost" : "You would lose"} ${formatMoney(lossOf(row))} · ` : null}
                {detail?.proposal.windowId ? <WindowRange windowId={detail.proposal.windowId} /> : "proposed "}
                {detail?.proposal.windowId ? null : <LocalTime value={row.proposedAt} />}
              </SheetDescription>
            </SheetHeader>
            <div className="flex w-full flex-col gap-5 px-[18px] pb-8 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={statusKeyOf(row, nowSeconds)} />
                <DeadlineChip row={row} />
              </div>

              <StatusTimeline label="Penalty" steps={penaltyTimeline(row)} orientation="vertical" />

              {row.tab === "disputed" ? (
                <p className="text-body-13 text-02">
                  You disputed this on chain, so it cannot be executed while Assay&apos;s <Term k="arbiter">arbiter</Term>{" "}
                  reviews it. The arbiter aims to rule within 7 days
                  {row.arbiterTargetAt ? (
                    <>
                      {" "}(by <LocalTime value={row.arbiterTargetAt} dateOnly />)
                    </>
                  ) : null}
                  {row.disputeExpiresAt ? (
                    <>
                      ; if nobody rules by <LocalTime value={row.disputeExpiresAt} dateOnly />, it expires and nothing is taken
                    </>
                  ) : null}
                  .
                </p>
              ) : row.canDispute ? (
                <p className="text-body-13 text-02">
                  Nothing is taken before <LocalTime value={row.executableAt} withZone className="font-semibold text-01" />. If you
                  think it is wrong, dispute it before then: one signature from your stake wallet, and Assay&apos;s{" "}
                  <Term k="arbiter">arbiter</Term>, a person, rules on it on chain.
                </p>
              ) : row.tab === "needs-action" ? (
                <p className="text-body-13 text-02">
                  {row.upheld ? "Assay's arbiter upheld it. " : "The dispute window has closed. "}It can be executed from{" "}
                  <LocalTime value={row.executableAt} withZone className="font-semibold text-01" />.
                </p>
              ) : null}

              <section className="flex flex-col gap-2">
                <h3 className="text-label-13 text-01">What it costs you</h3>
                <LossSentence row={row} />
              </section>

              {failures.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-label-13 text-01">What went wrong</h3>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-body-13 text-02">
                    {failures.map((failure) => (
                      <li key={failure.key}>{failureSentence(failure.key, failure.count)}</li>
                    ))}
                    {topAgent && totalFailures > 0 && topAgent.count / totalFailures > 0.5 ? (
                      <li>
                        {topAgent.count} of the {totalFailures} failures came from one agent.
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : !row.proposalId ? (
                <p className="text-body-13 text-warning-700">
                  Assay has no case for this penalty, so it cannot say why it was proposed. A penalty Assay does not know
                  may not be genuine: dispute it.
                </p>
              ) : null}

              {detail ? (
                <details className="rounded-lg border border-01 bg-02 px-3.5 py-2.5">
                  <summary className="cursor-pointer select-none text-label-13 text-01">Show derivation</summary>
                  <div className="mt-3">
                    <Measurement data={detail} />
                  </div>
                </details>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 text-body-xs text-03">
                On-chain record <CopyChip value={row.requestId} />
              </div>

              {row.canDispute ? (
                <div className="flex flex-col gap-1">
                  {disputeBlocked && onConnect ? (
                    <Button icon={<Wallet aria-hidden="true" />} onClick={onConnect}>
                      Connect stake wallet
                    </Button>
                  ) : (
                    <Button icon={<Scale aria-hidden="true" />} onClick={onDispute} disabled={Boolean(disputeBlocked)}>
                      Dispute on chain
                    </Button>
                  )}
                  {disputeBlocked ? <span className="text-body-xs text-03">{disputeBlocked}</span> : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ── the dispute sheet ────────────────────────────────────────────────── */

/**
 * The review step before the one signature. A dispute is final: one per
 * record (the contract refuses a second, `SlashAlreadyDisputed`), and it
 * carries no message, so everything the provider needs to decide is said here.
 */
export function DisputeSheet({
  row,
  toolName,
  steps,
  onOpenChange,
  onDisputed,
  simulated = false,
}: {
  row: PenaltyRow | null;
  toolName: string | null;
  steps: React.ComponentProps<typeof WalletActionSheet>["steps"];
  onOpenChange: (open: boolean) => void;
  onDisputed: () => void;
  /** DEMO ONLY: say that nothing is signed. */
  simulated?: boolean;
}) {
  const loss = row ? lossOf(row) : null;
  const split = row ? splitPenalty(lossBasis(row)) : null;
  return (
    <WalletActionSheet
      open={row !== null}
      onOpenChange={onOpenChange}
      title={toolName ? `Dispute the ${toolName} penalty` : "Dispute this penalty"}
      description={
        row ? (
          <>
            You can dispute this penalty once. The dispute carries no message: it asks Assay&apos;s{" "}
            <Term k="arbiter">arbiter</Term>, a person, to look at the record and rule on it on chain.
          </>
        ) : undefined
      }
      acknowledge="I understand I can dispute this penalty only once and cannot add anything later."
      steps={steps}
      label="Dispute on chain"
      resetKey={row?.id}
      describeError={describeDisputeError}
      successTitle="Disputed on chain"
      successDescription="The penalty is frozen. The arbiter aims to rule within 7 days; the ruling shows on this page."
      onSuccess={onDisputed}
      doneAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {row ? (
        <>
          <dl className="flex flex-col gap-2.5 rounded-lg border border-01 bg-02 px-3.5 py-3 text-body-13">
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-13 text-01">While the dispute stands</dt>
              <dd className="text-02">Nothing can be taken from your stake.</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-13 text-01">If the arbiter upholds it</dt>
              <dd className="text-02">
                You lose <span className="font-mono text-mono-13 font-semibold text-01">{formatMoney(loss)}</span> of your
                stake ({formatMoney(split?.agent)} to the buyers whose calls failed, {formatMoney(split?.platform)} to
                Assay). It can be taken from <LocalTime value={row.executableAt} withZone />, or as soon as it is upheld if
                that is later.
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-13 text-01">If the arbiter cancels it, or nobody rules within {DISPUTE_TIMEOUT_DAYS} days</dt>
              <dd className="text-02">Nothing is taken.</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-13 text-01">Cost</dt>
              <dd className="text-02">One network fee, paid in ETH by your stake wallet. The dispute itself is free.</dd>
            </div>
          </dl>
          {simulated ? <p className="text-body-xs text-03">{DEMO_SIGNING_NOTE}</p> : null}
        </>
      ) : null}
    </WalletActionSheet>
  );
}
