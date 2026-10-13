"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { DASH, stampUtc } from "@/features/g34a/stats";
import { asProposalStatus, caseBadgeVariant } from "@/features/operator/state";
import { SLASH_DELAY_HOURS } from "@/libs/chains/solana/delays";
import { chainStatusLabel } from "@/libs/chains/status-labels";
import { CaseContext } from "@/features/provider-slash-case/context";
import { Measurement } from "@/features/provider-slash-case/measurement";
import { remaining } from "@/features/provider-slash-case/status-header";
import { ApiError } from "@/libs/ApiClient";
import { getOperatorCase } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { ActionPanel } from "./_components/action-panel";

/**
 * The operator's case screen, route `/operator/cases/[proposalId]`.
 *
 * One read: `GET /operator/cases/:proposalId`, which answers with the whole
 * brief — the case, the provider's objection if one was filed, the event
 * timeline and the restoration record. This file renders all of it and
 * decides none of it; the actions live in their own panel and are
 * not stubbed here, because a disabled control that does nothing is a claim
 * about what this screen can do.
 *
 * ## Why two components come from the provider console
 *
 * `Measurement` and `CaseContext` render the *same* `SlashProposalCaseDetail`
 * the provider is shown, in a voice that addresses neither side: the frozen
 * arithmetic that produced the strike, and the prior windows / change overlay
 * / failure attribution around it. An adjudicator has to read exactly what the
 * provider read — a second rendering of the same numbers is a second thing
 * that can drift, and the thing it would drift about is how much money is
 * being taken. So they are imported, not re-drawn.
 *
 * The three that are **not** imported — `StatusHeader`, `WhatIsNotHappening`,
 * `WhatHappensIfYouDoNothing` — are written to the provider in the second
 * person ("your stake", "your clock"). On this surface "you" is the platform,
 * and reusing them would put the adjudicator inside the sentence as the
 * accused. Their content is instead carried by the header and the clocks
 * below, in the third person.
 *
 * ## Two things this screen does not have
 *
 * - **The provider's name.** `SlashProposalSummary` carries `providerId` and
 *   nothing else; the queue row's `providerName` is a field of
 *   `AdjudicationQueueRow`, which this response is not. The id is rendered as
 *   the id rather than a name being invented for it.
 * - **A window-level evidence pack.** `evidenceVerdictCount` is a count; no
 *   route opens the pack it counts. See the provider case screen's own note.
 */

/** The one nav control, in both the error states and the loaded one. */
function BackToQueue() {
  return (
    <Button variant="ghost" size="sm" asChild className="self-start">
      {/*
        The icon goes INSIDE the Link. `Button` renders `children` alone under
        `asChild` — Slot takes `React.Children.only` — so an `icon` prop passed
        alongside it is silently dropped and no arrow ever appears.
      */}
      <Link href="/operator">
        <ArrowLeft aria-hidden="true" />
        Adjudication queue
      </Link>
    </Button>
  );
}

/** One of the clocks. `left` is drawn on the running one only. */
function ClockRow({
  label,
  at,
  caption,
  left,
}: {
  label: string;
  at: string | null;
  caption: string;
  left?: string | null;
}) {
  return (
    <div className="flex w-full flex-col gap-1 border-t border-01 px-5 py-3.5 first:border-t-0 tablet:flex-row tablet:items-baseline tablet:gap-4">
      <span className="w-[180px] shrink-0 text-label-sm text-01">{label}</span>
      <span className="w-[160px] shrink-0 font-mono text-mono-13 text-01">
        {at ? `${stampUtc(at)} UTC` : DASH}
      </span>
      <span className="min-w-0 flex-1 text-body-13 text-02">{caption}</span>
      {left ? (
        <span className="shrink-0 font-mono text-mono-13 font-semibold text-01">{left}</span>
      ) : null}
    </div>
  );
}

/** A label/value line, used by the objection panel and the restoration record. */
function DetailRow({
  label,
  value,
  mono,
  meta,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  meta?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-1 border-t border-01 px-5 py-3 first:border-t-0 tablet:flex-row tablet:items-baseline tablet:gap-4">
      <dt className="w-[200px] shrink-0 text-body-13 text-03">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 flex-1 break-words font-mono text-mono-13 text-01"
            : "min-w-0 flex-1 text-body-13 leading-[1.55] text-01"
        }
      >
        {value}
      </dd>
      {meta ? (
        <span className="shrink-0 font-mono text-mono-12 text-03">{meta}</span>
      ) : null}
    </div>
  );
}

export default function OperatorCasePage() {
  const params = useParams<{ proposalId: string }>();
  const proposalId = params.proposalId;

  const caseQuery = useQuery({
    queryKey: ["operator", "case", proposalId],
    queryFn: () => getOperatorCase(proposalId),
    retry: 0,
  });

  const brief = caseQuery.data;

  /*
    Narrowed ONCE, here. `SlashProposalSummary.status` is a bare `string` — the
    provider-side interface types it that way — so it cannot be handed to
    `caseBadgeVariant` directly. `null` means the backend sent a status this
    build does not know, which is rendered as the raw text rather than crashing
    a screen an adjudicator is holding a deadline on.
  */
  const status = brief ? asProposalStatus(brief.case.proposal.status) : null;

  if (caseQuery.isError) {
    const error = caseQuery.error;
    // An unknown id and another organisation's case answer the SAME 404, on
    // purpose. Saying "no such case" is therefore the whole honest answer —
    // "you are not allowed to see this" would confirm that it exists.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <BackToQueue />
        {notFound ? (
          <p className="text-body-13 text-02">No such case.</p>
        ) : (
          <p className="text-body-13 text-danger-600" role="alert">
            The case could not be loaded.{" "}
            {error instanceof ApiError ? `${error.code} · ${error.message}` : String(error)}
          </p>
        )}
      </>
    );
  }

  if (!brief) {
    return (
      <>
        <BackToQueue />
        <p className="text-body-13 text-03">Loading the case…</p>
      </>
    );
  }

  const { proposal } = brief.case;
  const clocks = proposal.clocks;
  const dispute = brief.dispute;

  /*
    ONE countdown for the whole object. `secondsRemaining` belongs to whichever
    clock `runningClock` names, so it is drawn against that row alone —
    repeating it on all three would be a wrong number on two of them.
  */
  const left = remaining(clocks.secondsRemaining);
  const runningCopy =
    clocks.runningClock === "PROVIDER"
      ? "the provider's clock is running"
      : clocks.runningClock === "PLATFORM"
        ? "our clock is running"
        : "no clock is running";

  const timelineEvents: TimelineEvent[] = brief.timeline.map((event) => ({
    id: event.id,
    time: stampUtc(event.occurredAt),
    label: event.summary,
    meta: `${event.kind} · ${event.actorType}${event.actorId ? ` · ${event.actorId}` : ""}`,
  }));

  const seconded =
    dispute !== null &&
    (dispute.secondKind !== null || dispute.secondNote !== null || dispute.secondedAt !== null);

  return (
    <>
      <BackToQueue />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-heading-sm text-01 tablet:text-heading-md">
            {proposal.bindingLabel} {proposal.toolName}
            {proposal.windowLabel ? (
              <span className="text-03"> · window {proposal.windowLabel}</span>
            ) : null}
          </h1>
          {status ? (
            <Badge variant={caseBadgeVariant(status)} />
          ) : (
            // A status this build has no badge for. Printed as it arrived.
            <span className="font-mono text-mono-12 text-03">{proposal.status}</span>
          )}
        </div>
        <p className="font-mono text-mono-12 text-03">
          provider {proposal.providerId}
          <span className="text-03"> · </span>
          penalty{" "}
          <span className="font-semibold text-01">{formatMoney(proposal.penaltyAmount)}</span>
          <span className="text-03"> · </span>
          proposed {stampUtc(clocks.proposedAt)} UTC
          {brief.chainStatus ? (
            <>
              <span className="text-03"> · </span>
              on chain: <span className="font-semibold text-01">{chainStatusLabel(brief.chainStatus)}</span>
            </>
          ) : null}
        </p>
      </header>

      {/* ── The clocks — four once the chain's own deadline is mirrored ─ */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Clocks</PanelTitle>
            <PanelDescription>{runningCopy}</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          <ClockRow
            label="Provider responds by"
            at={clocks.respondByAt}
            caption={
              clocks.respondByAt
                ? "their window to object, opened when the notification was delivered"
                : "their window has not opened — delivery of the notification is not confirmed yet"
            }
            left={clocks.runningClock === "PROVIDER" ? left : null}
          />
          <ClockRow
            label="We decide by"
            at={clocks.platformDecisionDueAt}
            caption="our own deadline, set only once an objection is filed — nothing to run against before that"
            left={clocks.runningClock === "PLATFORM" ? left : null}
          />
          <ClockRow
            label="Earliest execution"
            at={clocks.earliestExecutionAt}
            caption="the timelock — nothing is taken from stake before this, whatever anyone decides"
          />
          {/*
            The chain's own deadline, rendered only when the row carries it.
            `execute_slash`'s `payer` is a bare `Signer` the program consults
            about nothing, so past this instant the judgement is executable by
            anyone at all and cancelling is no longer possible. Until the backend
            mirrors `chain_executable_at` the field is absent, and a row
            printing `Invalid Date` beside the word "anyone" is worse than no
            row — hence the conditional.
          */}
          {clocks.chainExecutableAt ? (
            <ClockRow
              label="Executable on chain"
              at={clocks.chainExecutableAt}
              caption="after this, anyone can execute the judgement — cancelling is no longer possible"
            />
          ) : null}
          <p className="border-t border-01 px-5 py-3.5 text-body-xs leading-[1.55] text-02">
            The provider gets 48 hours to object and we get 23 to decide, inside a{" "}
            {SLASH_DELAY_HOURS}-hour timelock — one hour short of filling it, deliberately. The
            hour is not spare change:
            the provider&rsquo;s window opens when the notification is <em>delivered</em>, not when
            the case was proposed, so every hour of delivery lag pushes our decision deadline
            later, and once the chain&rsquo;s own deadline passes anyone at all can execute the
            judgement. The hour is the band in which we can still cancel.
          </p>
        </PanelBody>
      </Panel>

      {/* ── The measurement, as the provider was shown it ─────────────── */}
      <Measurement data={brief.case} />

      {/* ── The context around the window ────────────────────────────── */}
      <CaseContext data={brief.case} />

      {/* ── The objection ────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>The objection</PanelTitle>
            <PanelDescription>
              {dispute ? "the provider's own words, as filed" : "none filed"}
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {dispute === null ? (
            <div className="px-5 py-5">
              <EmptyState
                title="No objection has been filed"
                description="If the provider's window closes without one, the proposal resolves as undisputed."
              />
            </div>
          ) : (
            /*
              `OperatorDisputeRecord` is the raw entity — `brief()` returns
              `findOneBy()` unmapped — so `state`, `claimType` and `secondKind`
              are plain strings, not the unions the DTOs use. Every one of them
              is printed as it arrived; nothing here maps a value into a set it
              might not belong to.
            */
            <dl className="flex w-full flex-col">
              <DetailRow label="Claim" value={dispute.claimType} mono />
              <DetailRow label="State" value={dispute.state} mono />
              <DetailRow label="Reason" value={dispute.reason} />
              <DetailRow label="Opened by" value={dispute.openedBy} mono />
              <DetailRow
                label="We decide by"
                value={
                  dispute.platformDueAt ? `${stampUtc(dispute.platformDueAt)} UTC` : DASH
                }
                mono
              />
              <DetailRow
                label="Assigned operator"
                value={
                  dispute.assignedOperatorId ?? (
                    <span className="text-danger-600">unassigned</span>
                  )
                }
                mono
              />
              {seconded ? (
                <>
                  <DetailRow label="Second signature" value={dispute.secondKind ?? DASH} mono />
                  {dispute.secondNote ? (
                    <DetailRow label="Second note" value={dispute.secondNote} />
                  ) : null}
                  {dispute.secondedAt ? (
                    <DetailRow
                      label="Seconded at"
                      value={`${stampUtc(dispute.secondedAt)} UTC`}
                      mono
                    />
                  ) : null}
                </>
              ) : null}
            </dl>
          )}
        </PanelBody>
      </Panel>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Case history</PanelTitle>
            <PanelDescription>every event on this case, ours as well as theirs</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {timelineEvents.length === 0 ? (
            <p className="px-5 py-4 text-body-13 text-02">
              Nothing has happened on this case yet.
            </p>
          ) : (
            <div className="w-full overflow-x-auto px-5 py-2">
              {/*
                `TimelineEvent` has three usable slots for five wire fields.
                `summary` is a backend-produced sentence and is the label;
                `kind`, `actorType` and `actorId` are folded into `meta`.
                `detail` is a free-form object with no rendering contract and
                is deliberately not drawn.
              */}
              <Timeline events={timelineEvents} className="min-w-[720px]" />
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ── Restoration ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Restoration</PanelTitle>
            <PanelDescription>what a decision for the provider would put back</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {brief.restoration.length === 0 ? (
            <p className="px-5 py-4 text-body-13 text-02">
              Nothing is recorded as restorable on this case.
            </p>
          ) : (
            <dl className="flex w-full flex-col">
              {brief.restoration.map((row) => (
                <DetailRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  meta={row.status.toLowerCase().replace(/_/g, " ")}
                />
              ))}
            </dl>
          )}
        </PanelBody>
      </Panel>

      {/* The actions. Gated on this token's roles and on the case's status,
          both inside the panel — this screen renders the case summary and
          decides nothing. */}
      <ActionPanel brief={brief} proposalId={proposalId} />
    </>
  );
}
