"use client";

import { Check, TrendingUp } from "lucide-react";
import * as React from "react";

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { stampUtc } from "@/features/g34a/stats";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { formatMoney, toDecimal } from "@/utils/money";

import {
  caseStageOf,
  closedSentence,
  executionFloorOf,
  type CaseChainStage,
  type ClosedStage,
} from "./chain-stage";

/**
 * The two panels the design puts **above** the arithmetic, in that order and
 * for that reason — "read this before the arithmetic".
 *
 * ## "What is not happening" is the most important panel on this screen
 *
 * Every line in it is a factual claim about what the platform will and will
 * not do to a provider's business while a case is open. A claim rendered here
 * that the response cannot support is worse than a missing claim: it is
 * reassurance offered by a system that does not actually know it is true, on
 * the one screen where a provider is deciding whether the platform's
 * arithmetic can be trusted at all.
 *
 * So each of the design's three lines is rendered **only** when a field backs
 * it, and the backing is shown next to the claim rather than asserted:
 *
 * 1. *"Your routing continues. This proposal does not pause traffic."*
 *    `inaction.routingContinues`. The DTO's own comment says it is always
 *    `true` and is carried anyway; this reads it rather than assuming it, so
 *    the day it can be `false` this panel stops making the promise.
 * 2. *"Nothing is taken from earnings already paid to you."* Backed by the
 *    forecast's own arithmetic: the penalty comes out of **stake**, and
 *    `stakeBefore − stakeAfter` equals the proposed penalty exactly. The
 *    identity is checked before the line renders, and the two stake figures
 *    are shown as its proof. The design's second sentence — *"Payouts are
 *    final."* — has **no field anywhere on this response** and is not
 *    rendered; see the task report.
 * 3. *"Nothing executes before the deadline above, even if you do nothing."*
 *    `clocks.earliestExecutionAt`, which the database also holds as a CHECK
 *    constraint (`chk_slash_proposals_execution_respects_timelock`), so it is
 *    a promise a service that forgot could not break.
 *
 * ## "What happens if you do nothing"
 *
 * The design's green note — *"Projected: floor restored in ~14 hours from
 * earnings"* — is conditional, not decoration. `graceHours` and
 * `projectedRestoreHours` are null whenever the floor is **not** breached, and
 * `projectedRestoreHours` is also null when there is no earnings run-rate to
 * project from. The two nulls are indistinguishable on the wire, so the note
 * renders only when a number is actually there.
 *
 * What the note may no longer say is that the floor restores **by itself**.
 * Lean v3 pays a provider's share to their own token account at redemption, so
 * there is no held balance to sweep into stake and the run-rate is a forecast
 * of what they could deposit, not of what will happen. Same field, weaker
 * claim, stated as a rate rather than as an outcome.
 */

function Claim({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex w-full items-start gap-3 border-t border-01 px-5 py-3.5 first:border-t-0">
      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-600" />
      <p className="min-w-0 flex-1 text-body-sm leading-[1.55] text-01">{children}</p>
    </li>
  );
}

export function WhatIsNotHappening({ data }: { data: SlashProposalCaseDetail }) {
  const { inaction, proposal } = data;

  // The stake identity: does the penalty come entirely out of stake? Only if
  // it does is the "nothing from earnings already paid" line something this
  // response can support.
  const reduction = toDecimal(inaction.stakeBefore).minus(toDecimal(inaction.stakeAfter));
  const fromStake = reduction.eq(toDecimal(proposal.penaltyAmount));

  const claims: React.ReactNode[] = [];

  if (inaction.routingContinues) {
    claims.push(
      <Claim key="routing">Your routing continues. This proposal does not pause traffic.</Claim>
    );
  }

  if (fromStake) {
    claims.push(
      <Claim key="earnings">
        Nothing is taken from earnings already paid to you.{" "}
        <span className="text-02">
          The penalty comes out of stake: {formatMoney(inaction.stakeBefore)} →{" "}
          {formatMoney(inaction.stakeAfter)}.
        </span>
      </Claim>
    );
  }

  const stage = caseStageOf(proposal);
  /* A closed case has no execution ahead of it to promise anything about. */
  if (stage.kind !== "closed") {
    claims.push(
      stage.kind === "disputed" ? (
        <Claim key="timelock">
          Nothing executes while your on-chain dispute stands.{" "}
          <span className="text-02">
            The stake contract refuses to execute a disputed penalty until Assay&apos;s arbiter rules.
          </span>
        </Claim>
      ) : (
        <Claim key="timelock">
          Nothing executes before the deadline above, even if you do nothing.{" "}
          <span className="text-02">
            The earliest anything can execute is {stampUtc(stage.executableAt)} UTC.
          </span>
        </Claim>
      )
    );
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>What is not happening</PanelTitle>
          <PanelDescription>read this before the arithmetic</PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody>
        <ul className="flex w-full flex-col">{claims}</ul>
      </PanelBody>
    </Panel>
  );
}

export function WhatHappensIfYouDoNothing({ data }: { data: SlashProposalCaseDetail }) {
  const { inaction } = data;
  /*
    `inaction.executesAt` is Assay's off-chain promise. The on-chain record
    can open later than that, and nothing is taken before both have passed, so
    the sentence names the later of the two (`executionFloorOf`).
  */
  const executesAt = laterOf(inaction.executesAt, executionFloorOf(data.proposal.clocks));

  const floorSentence = inaction.fallsBelowMinimum
    ? `below your ${formatMoney(inaction.minimumRequired)} minimum. ` +
      /*
        NO automatic sweep is promised any more. There is no such thing as
        unpaid earnings since `redeem_voucher` began paying the provider's own
        token account inside the settling transaction — nothing accrues here
        that the platform could sweep, so a sentence saying it would be a
        promise about a mechanism that no longer exists. The grace period and
        the continued routing are real and still stated.
      */
      (inaction.graceHours !== null
        ? `A ${inaction.graceHours}-hour grace period starts and routing continues, so you can top the stake back up without losing traffic.`
        : "Routing continues while the shortfall stands.")
    : `still above your ${formatMoney(inaction.minimumRequired)} minimum, so no grace period opens and nothing changes about how you are routed.`;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>What happens if you do nothing</PanelTitle>
          <PanelDescription>the most common response, so its consequence is stated</PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="gap-3.5 px-5 py-4">
        <p className="text-body-sm leading-[1.55] text-01">
          On {stampUtc(executesAt)} UTC the penalty is taken from stake. Your stake falls
          to {formatMoney(inaction.stakeAfter)}, {floorSentence}
        </p>

        {inaction.fallsBelowMinimum && inaction.projectedRestoreHours !== null ? (
          <div className="flex w-full items-start gap-2.5 rounded-lg bg-success-10 px-3.5 py-3">
            <TrendingUp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-600" />
            <p className="min-w-0 flex-1 text-body-13 leading-[1.55] text-success-700">
              Projected: at your current rate you would earn the shortfall back in
              ~{inaction.projectedRestoreHours} hours. Your earnings are paid straight to your
              wallet, so putting them back into stake is a deposit you make.
            </p>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** The later of two ISO instants; an unparseable one loses. */
function laterOf(a: string, b: string): string {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
}

function Outcome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex w-full flex-col gap-0.5 border-t border-01 px-5 py-3 first:border-t-0">
      <span className="text-label-13 text-01">{title}</span>
      <span className="text-body-13 leading-[1.55] text-02">{children}</span>
    </li>
  );
}

/**
 * "What happens next", in place of "What happens if you do nothing" once the
 * provider disputed on chain. Doing nothing is no longer the decision in
 * front of them: the dispute is in, and the case waits on Assay's arbiter
 * (`disputed`) or on the record's `executableAt` after an uphold (`upheld`).
 * Every date is the on-chain record's, mirrored by the backend.
 */
export function WhatHappensNext({
  data,
  stage,
}: {
  data: SlashProposalCaseDetail;
  stage: Exclude<CaseChainStage, { kind: "open" }>;
}) {
  const { inaction } = data;
  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>What happens next</PanelTitle>
          <PanelDescription>
            {stage.kind === "disputed"
              ? "disputed on chain, awaiting Assay's arbiter"
              : "your dispute was upheld by Assay's arbiter"}
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody>
        {stage.kind === "disputed" ? (
          <ul className="flex w-full flex-col">
            <Outcome title="Now">
              {stage.disputedAt
                ? `You disputed this penalty on chain on ${stampUtc(stage.disputedAt)} UTC. `
                : "You disputed this penalty on chain. "}
              It cannot be executed while Assay&apos;s arbiter decides. You do not need to do
              anything else.
            </Outcome>
            <Outcome title="If the arbiter upholds it">
              The penalty can be executed from its on-chain time, or from the ruling if that is
              later, and the penalty is taken from stake: your stake falls to{" "}
              {formatMoney(inaction.stakeAfter)}. A penalty can be disputed on chain only once, so
              it cannot be disputed again.
            </Outcome>
            <Outcome title="If the arbiter cancels it">
              The penalty is cancelled on chain and the reserved stake is released. Nothing is
              taken.
            </Outcome>
            <Outcome title="If there is no ruling">
              {stage.expiresAt
                ? `From ${stampUtc(stage.expiresAt)} UTC, 30 days after the dispute, anyone can expire it, which releases the reserved stake.`
                : "Thirty days after the dispute, anyone can expire it, which releases the reserved stake."}
            </Outcome>
          </ul>
        ) : (
          <ul className="flex w-full flex-col">
            <Outcome title="The ruling">
              {stage.disputedAt
                ? `You disputed this penalty on chain on ${stampUtc(stage.disputedAt)} UTC, and Assay's arbiter upheld it. `
                : "Assay's arbiter upheld your on-chain dispute. "}
              A penalty can be disputed on chain only once, so it cannot be disputed again.
            </Outcome>
            <Outcome title="Next">
              {`From ${stampUtc(stage.executableAt)} UTC anyone can execute it, and the penalty is taken from stake. Your stake falls to ${formatMoney(inaction.stakeAfter)}.`}
            </Outcome>
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * In place of the open case's panels once the case is closed — cancelled or
 * expired on chain, executed, overturned, compensated, waived or suspended.
 * It says what happened and that no deadline, execution or action is left.
 */
export function CaseClosed({ stage }: { stage: ClosedStage }) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Case closed</PanelTitle>
          <PanelDescription>nothing more happens on this case</PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="px-5 py-4">
        <p className="text-body-sm leading-[1.55] text-01">{closedSentence(stage, stampUtc)}</p>
      </PanelBody>
    </Panel>
  );
}
