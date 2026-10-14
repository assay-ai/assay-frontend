"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderOpen, Scale, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { count, stampUtc } from "@/features/g34a/stats";
import { DisputeFilingForm } from "@/features/provider-disputes/dispute-filing-form";
import {
  CaseClosed,
  WhatHappensIfYouDoNothing,
  WhatHappensNext,
  WhatIsNotHappening,
} from "@/features/provider-slash-case/assurances";
import { useNowSeconds } from "@/features/chain-slashes/use-chain-slashes";
import {
  caseStageOf,
  disputeDeadlineOf,
  disputesOnChain,
  mayAcknowledge,
  mayDisputeOnChain,
  onChainDisputeHref,
  onChainDisputeSentence,
} from "@/features/provider-slash-case/chain-stage";
import { CaseContext } from "@/features/provider-slash-case/context";
import { eventLabel, eventSummary } from "@/features/provider-slash-case/labels";
import { Measurement } from "@/features/provider-slash-case/measurement";
import { StatusHeader } from "@/features/provider-slash-case/status-header";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { withAcknowledgedEvent } from "@/features/provider-disputes/timeline";
import { getSlashProposalTimeline } from "@/services/provider-disputes.service";
import {
  acknowledgeSlashProposal,
  getSlashProposalCaseDetail,
} from "@/services/provider-slash-cases.service";
import { useSearchParam } from "@/hooks/useSearchParam";
import { routes } from "@/libs/routes";

/**
 * The slash proposal case — route
 * `/provider/cases/[proposalId]`.
 *
 * One case: what is being taken, on what evidence, by when, and what a
 * provider can do about it. The frame's order is the argument and is kept
 * exactly — the status and both clocks, the three figures, **what is not
 * happening**, **what happens if you do nothing**, the context that would win
 * a dispute, the actions, and only then the arithmetic. The measurement is
 * last on purpose: a provider reads what is being done to their business
 * before they read the sum that justifies it.
 *
 * ## Reads
 *
 * - `GET /providers/me/slash-proposals/:id` — the whole case in one response
 *   (`SlashProposalCaseDto`). Typed as `SlashProposalCaseDetail`, which
 *   **extends** the dispute filing screen's `SlashProposalCase` rather than restating it, and
 *   shares that screen's cache key so mounting the filing form inline below
 *   reuses this fetch.
 * - `GET /providers/me/slash-proposals/:id/timeline` — the case history.
 *   Rendered as a short strip, not as the dispute case screen's full case-state screen: the
 *   restoration record it also returns belongs to that screen and is not
 *   drawn twice here.
 *
 * ## Writes
 *
 * - `POST …/acknowledge` — records that the provider has seen the case. It
 *   moves **no clock**, and the button says so, because a control that looks
 *   like it might buy time and does not is worse than no control.
 * - **Dispute** — on EVM (every case the console stakes today) the dispute is
 *   the on-chain `disputeSlash`, sent from the provider's own stake wallet:
 *   the button opens the penalties on chain page with this case's records
 *   selected, and that page builds, checks and sends the transaction. There
 *   is no in-app objection, extension or platform deadline for such a case;
 *   Assay's arbiter rules on chain. A Solana case (`disputeOnChain: false`)
 *   keeps `POST …/dispute` through `DisputeFilingForm`, mounted inline.
 *
 * Both writes answer with the whole case, which is seeded straight into the
 * cache with `setQueryData`. A refetch would be wrong rather than merely
 * wasteful: provider `GET`s are HTTP-cached for 10s with an hour of
 * stale-while-revalidate, so a read immediately after a write is served the
 * pre-write body.
 *
 * ## What this screen does NOT render, and why
 *
 * Everything below is a control or a figure the frame draws that no field on
 * the wire supports. Each is absent rather than approximated.
 *
 * - **"Download pack"** — no endpoint returns a downloadable evidence pack for
 *   a window. `evidenceVerdictCount` is a count and nothing more.
 * - **"Open evidence (612 verdicts)"** as a link. The count is real and is
 *   rendered; the destination is not. `GET /providers/me/verdicts/:id/evidence`
 *   is per **verdict**, and this case is about a window — there is no route
 *   that opens "the evidence for window w_6". The count therefore renders as a
 *   figure, and the binding's SLA screen (which does read that window) is
 *   offered as the nearest real destination.
 * - **"Re-derive yourself"**, **"View diff"** — see `measurement.tsx` and
 *   `context.tsx`.
 * - **"(dashboard)"** next to the acknowledgement stamp — the channel is not
 *   recorded; see `status-header.tsx`.
 * - **"Payouts are final."** — see `assurances.tsx`.
 *
 * ## Not this screen
 *
 * The operator's side of the same case — claiming it, adjudicating it,
 * seconding a decision — is a different surface behind a different guard. A
 * provider can see their case, acknowledge it and object to it; nothing here
 * decides it.
 */

const CASE_KEY = (proposalId: string) => ["provider", "slash-proposal-case", proposalId];

/** The statuses in which objecting is still possible — the button is drawn only then. */
const DISPUTABLE: readonly string[] = ["PROPOSED"];

export default function SlashProposalCasePage() {
  const proposalId = useSearchParam("id");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filing, setFiling] = React.useState(false);
  const nowSeconds = useNowSeconds();

  const caseQuery = useQuery({
    queryKey: CASE_KEY(proposalId),
    queryFn: () => getSlashProposalCaseDetail(proposalId),
    retry: 0,
  });
  const data: SlashProposalCaseDetail | undefined = caseQuery.data;

  const timelineQuery = useQuery({
    queryKey: ["provider", "slash-proposal-timeline", proposalId],
    queryFn: () => getSlashProposalTimeline(proposalId),
    retry: 0,
  });

  const acknowledge = useMutation({
    mutationFn: () => acknowledgeSlashProposal(proposalId),
    onSuccess: (updated) => {
      queryClient.setQueryData(CASE_KEY(proposalId), updated);
      void queryClient.invalidateQueries({
        queryKey: ["provider", "slash-proposal-timeline", proposalId],
      });
    },
  });

  // ── Not found / not yours ────────────────────────────────────────────────
  //
  // A case in another organization answers the SAME 404 a non-existent id
  // does — deliberately, and the copy must not distinguish them.
  if (caseQuery.isError) {
    return (
      <Banner
        tone="danger"
        title="No case with this id."
        description="Either no slash proposal has this id, or it does not belong to your organisation. We cannot say which."
      />
    );
  }

  if (!data) {
    return (
      <p className="text-body-13 text-03">Loading the case…</p>
    );
  }

  const { proposal } = data;
  const events = withAcknowledgedEvent(timelineQuery.data?.events ?? [], proposal);

  /*
    ONE instant to plan against, deliberately: the LATER of the platform's
    `earliestExecutionAt` and the chain's own `chainExecutableAt`
    (`executionFloorOf`, which can only overstate the wait). Once the provider
    disputed on chain the record cannot be executed at all until the arbiter
    rules, and after an uphold the record's own time is the one that binds —
    so the stage decides what the screen says (`chain-stage.ts`). A closed
    case (cancelled or expired on chain, executed, overturned, compensated,
    waived) has no deadline, no execution ahead and no action left.
  */
  const stage = caseStageOf(proposal);
  const onChain = disputesOnChain(proposal.clocks);
  /* Disputed on chain or upheld after it: a record is disputed at most once. */
  const canDispute = onChain
    ? mayDisputeOnChain(proposal, stage, nowSeconds * 1000)
    : DISPUTABLE.includes(proposal.status) && proposal.disputeId === null && stage.kind === "open";

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <header className="flex w-full min-w-0 flex-col gap-0.5">
        <h1 className="truncate text-heading-sm text-01 tablet:text-heading-md">
          Proposed penalty · {proposal.toolName}
        </h1>
        <p className="font-mono text-mono-12 text-03">
          case {proposal.id} · proposed {stampUtc(proposal.clocks.proposedAt)} UTC
        </p>
      </header>

      {/* ── Status header, both clocks, three figures ─────────────────── */}
      <StatusHeader data={data} />

      {/* ── The one deadline that binds your stake ────────────────────── */}
      {stage.kind === "closed" ? null : stage.kind === "disputed" ? (
        <p className="text-body-13 leading-[1.55] text-02">
          You disputed this penalty on chain. Nothing can be taken from your stake while the
          dispute stands: it waits for Assay&apos;s arbiter to rule
          {stage.expiresAt ? (
            <>
              {", and unruled it can be expired from "}
              <span className="font-mono text-mono-13 font-semibold text-01">
                {stampUtc(stage.expiresAt)} UTC
              </span>
            </>
          ) : null}
          .
        </p>
      ) : stage.kind === "upheld" ? (
        <p className="text-body-13 leading-[1.55] text-02">
          Assay&apos;s arbiter upheld your on-chain dispute. The penalty can be executed from{" "}
          <span className="font-mono text-mono-13 font-semibold text-01">
            {stampUtc(stage.executableAt)} UTC
          </span>
          , and it cannot be disputed again.
        </p>
      ) : (
        <p className="text-body-13 leading-[1.55] text-02">
          Nothing can be taken from your stake before{" "}
          <span className="font-mono text-mono-13 font-semibold text-01">
            {stampUtc(stage.executableAt)} UTC
          </span>
          . Every deadline this case runs on has passed by then, so this is the date to plan
          against — the wait can be longer than it, never shorter.
          {stage.disputedParts > 0
            ? ` ${stage.disputedParts === 1 ? "One part" : `${stage.disputedParts} parts`} of this case ${stage.disputedParts === 1 ? "is" : "are"} disputed on chain and cannot execute until the arbiter rules; the other parts are not affected.`
            : null}
        </p>
      )}

      {canDispute && onChain ? (
        <p className="text-body-13 font-semibold leading-[1.55] text-01">
          {onChainDisputeSentence(disputeDeadlineOf(proposal.clocks), stampUtc)}
        </p>
      ) : null}

      {/* The independent check: the same penalty, read from the chain and not from us. */}
      <p className="text-body-13 text-02">
        This page is Assay&apos;s account of the case.{" "}
        <Link href="/provider/capital/penalties" className="underline">
          Check the penalties on chain
        </Link>{" "}
        to see what the stake contract itself holds against your stake.
      </p>

      {/* ── The two panels the frame puts before the arithmetic ───────── */}
      <div className="flex w-full flex-col gap-5 tablet:flex-row tablet:items-start">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-5">
          {stage.kind === "closed" ? (
            <CaseClosed stage={stage} />
          ) : (
            <>
              <WhatIsNotHappening data={data} />
              {stage.kind === "open" ? (
                <WhatHappensIfYouDoNothing data={data} />
              ) : (
                <WhatHappensNext data={data} stage={stage} />
              )}
            </>
          )}
        </div>
        <div className="w-full min-w-0 flex-1">
          <CaseContext data={data} />
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <section className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-01 bg-01 px-3.5 py-2.5">
          <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-03" />
          {/* The count is real; the destination is not. See the file header. */}
          <p className="min-w-0 flex-1 text-body-13 text-02">
            {`${count(data.evidenceVerdictCount)} verdict${
              data.evidenceVerdictCount === 1 ? "" : "s"
            } sealed in this window's evidence pack. ${
              data.evidenceVerdictCount === 0
                ? "Nothing has been sealed for it, so there is no pack to open."
                : "Opening a whole window's pack is not available yet — the binding's Live SLA page is the nearest view of it."
            }`}
          </p>
        </div>

        {mayAcknowledge(proposal, stage) ? (
          <Button
            variant="secondary"
            icon={<Check aria-hidden="true" />}
            loading={acknowledge.isPending}
            disabled={acknowledge.isPending}
            onClick={() => acknowledge.mutate()}
          >
            Acknowledge
          </Button>
        ) : null}

        {canDispute && onChain ? (
          <Button asChild>
            <Link href={onChainDisputeHref(proposal.id)}>
              <Scale aria-hidden="true" />
              Dispute on chain
            </Link>
          </Button>
        ) : canDispute ? (
          <Button
            variant={filing ? "secondary" : "primary"}
            icon={filing ? <X aria-hidden="true" /> : <Scale aria-hidden="true" />}
            onClick={() => setFiling((open) => !open)}
          >
            {filing ? "Close" : "Dispute"}
          </Button>
        ) : null}
      </section>

      {proposal.clocks.acknowledgedAt !== null ? (
        <p className="text-body-xs text-03">
          Acknowledged {stampUtc(proposal.clocks.acknowledgedAt)} UTC. Acknowledging records that
          you have seen the case; it does not move any deadline in either direction.
        </p>
      ) : null}

      {acknowledge.isError ? (
        <Banner
          tone="danger"
          title="That could not be recorded."
          description="The acknowledgement was not saved. Nothing else about the case has changed."
        />
      ) : null}

      {/* ── Dispute filing, mounted inline ───────────────────────────── */}
      {filing && !onChain ? (
        <DisputeFilingForm
          proposalId={proposalId}
          onCancel={() => setFiling(false)}
          onFiled={(result) => {
            setFiling(false);
            void queryClient.invalidateQueries({ queryKey: CASE_KEY(proposalId) });
            const disputeId = result.proposal.disputeId;
            router.push(disputeId ? routes.dispute(disputeId) : "/provider/disputes");
          }}
        />
      ) : null}

      {/* ── The measurement ──────────────────────────────────────────── */}
      <Measurement data={data} />

      {/* ── Case history ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Case history</PanelTitle>
            <PanelDescription>every event on this case, ours as well as yours</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {events.length === 0 ? (
            <p className="px-5 py-4 text-body-13 text-02">
              {timelineQuery.isError
                ? "The history could not be loaded. The case itself above is unaffected."
                : "Nothing has happened on this case yet."}
            </p>
          ) : (
            <ol className="flex w-full flex-col">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex w-full flex-col gap-1 border-t border-01 px-5 py-3 first:border-t-0 tablet:flex-row tablet:items-baseline tablet:gap-3.5"
                >
                  <span className="shrink-0 font-mono text-mono-12 text-03">
                    {stampUtc(event.occurredAt)}
                  </span>
                  {/* The event in words; the API's own code stays under it, small. */}
                  <span className="flex w-[190px] shrink-0 flex-col">
                    <span className="text-label-13 text-01">{eventLabel(event.kind)}</span>
                    <span className="font-mono text-mono-2xs text-03">{event.kind}</span>
                  </span>
                  {/* The stored sentence, with its amounts as money and its ids as names. */}
                  <span className="min-w-0 flex-1 text-body-13 text-02">
                    {eventSummary(event.summary, {
                      ...proposal.penaltyAmount,
                      toolName: proposal.toolName,
                      bindingId: proposal.bindingId,
                    })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
