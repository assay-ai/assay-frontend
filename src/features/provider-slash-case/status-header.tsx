"use client";

import * as React from "react";

import { DASH, stampUtc } from "@/features/g34a/stats";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { caseChainStatusLabel } from "@/libs/chains/status-labels";
import { formatMoney } from "@/utils/money";

import {
  closedHeadlineOf,
  TERMINAL_CASE_STATUSES,
  caseStageOf,
  disputeDeadlineOf,
  disputesOnChain,
  respondByApplies,
  type CaseStage,
} from "./chain-stage";

/**
 * `dObK1`'s status header — the pill, the two identities, both delivery
 * stamps, and the three figures.
 *
 * ## The pill
 *
 * The design shows `BREACH PROPOSED`, which is the *window's* outcome, not the
 * proposal's status. The two agree only while a case is fresh: the same
 * header has to render a case that is `DISPUTED`, `UNDER_REVIEW`, `UPHELD`,
 * `EXECUTED` or `REVERSED`, and a screen that said "BREACH PROPOSED" over an
 * executed penalty would be lying about the most important word on it. So the
 * pill renders `proposal.status`, and `PROPOSED` is written as the design's
 * words because that is the state the design is drawn in.
 *
 * ## The clocks
 *
 * `respondByAt` is **null until delivery is confirmed** — that is the design's
 * own rule ("a webhook to a dead endpoint must not consume their appeal
 * window") expressed as a nullable column. When it is null the figure renders
 * `DASH` and says why, rather than substituting `proposedAt + 48h`, which
 * would be this screen inventing a deadline the platform has not committed to.
 *
 * `secondsRemaining` counts down whichever clock is running and is `null` when
 * none is; `runningClock` names which. Both come from the server, so the
 * remaining time on this screen and the remaining time in the adjudication
 * queue cannot disagree. The countdown is drawn under "Respond by" only while
 * the PROVIDER clock is the one running — after a dispute the server counts
 * down Assay's decision deadline, which is not the provider's.
 *
 * ## Once the chain is involved
 *
 * A case disputed on chain, or upheld after that dispute, is no longer
 * waiting on the provider and no longer executes at the off-chain promise.
 * The second figure then says what it is waiting for (the arbiter, or the
 * upheld ruling) and the third reads the on-chain record (`chain-stage.ts`).
 */

const STATUS_COPY: Record<string, { label: string; tone: "danger" | "primary" | "success" }> = {
  PROPOSED: { label: "BREACH PROPOSED", tone: "danger" },
  DISPUTED: { label: "DISPUTED", tone: "primary" },
  UNDER_REVIEW: { label: "UNDER REVIEW", tone: "primary" },
  AWAITING_SECOND: { label: "AWAITING SECOND SIGNATURE", tone: "primary" },
  UPHELD: { label: "UPHELD", tone: "danger" },
  OVERTURNED: { label: "OVERTURNED", tone: "success" },
  EXECUTING: { label: "EXECUTING", tone: "danger" },
  EXECUTED: { label: "EXECUTED", tone: "danger" },
  // The column is still `REVERSED`; what happened is a treasury deposit back
  // into the provider's stake, not a program door that undid the slash.
  REVERSED: { label: "COMPENSATED", tone: "success" },
  WAIVED: { label: "WAIVED", tone: "success" },
  // Decided, and waiting on the program admin's signature. Not a resting state.
  CANCEL_REQUESTED: { label: "CANCELLATION REQUESTED", tone: "primary" },
  CANCELLED: { label: "CANCELLED", tone: "success" },
};

const pillTone: Record<"danger" | "primary" | "success", string> = {
  danger: "bg-danger-10 text-danger-700",
  primary: "bg-03 text-02",
  success: "bg-success-10 text-success-700",
};

/** `2d 21h remaining`, as the design writes it. Seconds come from the server. */
export function remaining(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds <= 0) return "0h remaining";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

/** One of the three figures. Value is mono and large; both lines are optional. */
function Figure({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: "danger";
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-body-xs text-03">{label}</span>
      <span
        className={
          tone === "danger"
            ? "font-mono text-mono-md font-semibold text-danger-600 tablet:text-mono-xl"
            : "font-mono text-mono-md font-semibold text-01 tablet:text-mono-xl"
        }
      >
        {value}
      </span>
      <span className="text-body-xs text-03">{caption}</span>
    </div>
  );
}

interface FigureCopy {
  label: string;
  value: string;
  caption: string;
  tone?: "danger";
}

/** The second figure: the provider's deadline while it binds, else what the case waits on. */
export function waitingFigure(data: SlashProposalCaseDetail, stage: CaseStage): FigureCopy {
  const { proposal } = data;
  const clocks = proposal.clocks;
  if (stage.kind === "closed") {
    return {
      label: "Case",
      value: "Closed",
      caption: `${closedHeadlineOf(stage).toLowerCase()}; no deadline runs and there is nothing for you to do`,
    };
  }
  if (stage.kind === "disputed") {
    return {
      label: "Awaiting Assay's arbiter",
      value: stage.expiresAt ? `${stampUtc(stage.expiresAt)} UTC` : DASH,
      caption: stage.disputedAt
        ? `disputed on chain ${stampUtc(stage.disputedAt)} UTC; if the arbiter has not ruled by then, it can be expired and your stake released`
        : "disputed on chain; unruled after 30 days, it can be expired and your stake released",
    };
  }
  if (stage.kind === "upheld") {
    return {
      label: "Dispute",
      value: "Upheld",
      caption: stage.disputedAt
        ? `you disputed on chain ${stampUtc(stage.disputedAt)} UTC and Assay's arbiter upheld it; a penalty can be disputed on chain only once`
        : "Assay's arbiter upheld your on-chain dispute; a penalty can be disputed on chain only once",
      tone: "danger",
    };
  }
  if (disputesOnChain(clocks)) {
    // The one deadline on EVM: the record's executableAt. No in-app clock.
    const by = disputeDeadlineOf(clocks);
    // Per record (review N-4): the backend's `disputeBy` stays set while any
    // record is still Pending and undisputed, whatever a sibling's dispute or
    // the case status say. An older backend without it: `PROPOSED` only.
    const disputable =
      clocks.disputeBy !== undefined
        ? clocks.disputeBy !== null || (proposal.status === "PROPOSED" && !clocks.chainExecutableAt)
        : proposal.status === "PROPOSED";
    if (!disputable) {
      return {
        label: "Dispute on chain by",
        value: by ? `${stampUtc(by)} UTC` : DASH,
        caption: "the case is past the point of a dispute",
      };
    }
    const left = clocks.runningClock === "PROVIDER" ? remaining(clocks.secondsRemaining) : null;
    return by
      ? {
          label: "Dispute on chain by",
          value: `${stampUtc(by)} UTC`,
          caption: `${left ? `${left} · ` : ""}disputing freezes the penalty on chain until the arbiter decides`,
          tone: "danger",
        }
      : {
          label: "Dispute on chain by",
          value: DASH,
          caption: "you can dispute once the penalty's record is on chain",
        };
  }
  const respondBy = clocks.respondByAt;
  if (!respondBy) {
    return {
      label: "Respond by",
      value: DASH,
      caption:
        "your clock starts when the notification is delivered, and delivery is not confirmed yet",
    };
  }
  if (!respondByApplies(proposal, stage)) {
    return {
      label: "Respond by",
      value: `${stampUtc(respondBy)} UTC`,
      caption: proposal.disputeId
        ? "your dispute is filed, so this deadline no longer applies"
        : "this deadline no longer applies to the case as it stands",
    };
  }
  const left = clocks.runningClock === "PROVIDER" ? remaining(clocks.secondsRemaining) : null;
  return {
    label: "Respond by",
    value: `${stampUtc(respondBy)} UTC`,
    caption: left ?? "the response window has closed",
    tone: clocks.runningClock === "PROVIDER" ? "danger" : undefined,
  };
}

/** The third figure: when stake can be taken, read from the on-chain record once there is one. */
export function executesFigure(stage: CaseStage): FigureCopy {
  if (stage.kind === "closed") {
    if (stage.outcome === "executed" || stage.outcome === "compensated") {
      return {
        label: "Executed",
        value: stage.executedAt ? `${stampUtc(stage.executedAt)} UTC` : DASH,
        caption:
          stage.outcome === "compensated"
            ? "taken from stake, then deposited back by Assay"
            : stage.partly
              ? "taken from stake in part; the cancelled records took nothing, and nothing more will be"
              : "taken from stake; nothing more will be",
      };
    }
    return { label: "Execution", value: "None", caption: "nothing will be taken from your stake" };
  }
  if (stage.kind === "disputed") {
    return {
      label: "Executes",
      value: "Not while disputed",
      caption: "the on-chain record cannot be executed until the arbiter rules",
    };
  }
  if (stage.kind === "upheld") {
    return {
      label: "Can be executed from",
      value: `${stampUtc(stage.executableAt)} UTC`,
      caption: "the on-chain record's own time; from then anyone can execute it",
      tone: "danger",
    };
  }
  return {
    label: "Executes",
    value: `${stampUtc(stage.executableAt)} UTC`,
    caption: "never before that deadline, even if you do nothing",
  };
}

/**
 * The pill follows the on-chain state where it is further along than the
 * case status: an upheld record reads UPHELD although the case still says
 * DISPUTED, and a record executed or released on chain reads EXECUTED or
 * CANCELLED although the case status has not caught up.
 */
export function statusChipOf(
  proposalStatus: string,
  stage: CaseStage,
): { label: string; tone: "danger" | "primary" | "success" } {
  const ownStatus = STATUS_COPY[proposalStatus] ?? {
    label: proposalStatus.replace(/_/g, " "),
    tone: "primary" as const,
  };
  if (stage.kind === "upheld") return STATUS_COPY.UPHELD;
  if (stage.kind === "closed" && !TERMINAL_CASE_STATUSES.includes(proposalStatus)) {
    if (stage.outcome === "executed") return STATUS_COPY.EXECUTED;
    return STATUS_COPY.CANCELLED;
  }
  return ownStatus;
}

export function StatusHeader({ data }: { data: SlashProposalCaseDetail }) {
  const { proposal } = data;
  const clocks = proposal.clocks;
  const stage = caseStageOf(proposal);
  const status = statusChipOf(proposal.status, stage);
  const waiting = waitingFigure(data, stage);
  const executes = executesFigure(stage);
  const onChain =
    clocks.chainStatus && clocks.chainStatus !== "NONE"
      ? caseChainStatusLabel(clocks, proposal.penaltyAmount.asset)
      : null;

  return (
    <section className="flex w-full flex-col gap-5 rounded-xl border border-01 bg-01 p-4 shadow-soft tablet:px-5 tablet:py-[18px]">
      {/* ── Identity row ─────────────────────────────────────────────── */}
      <div className="flex w-full flex-col items-start gap-2.5 tablet:flex-row tablet:items-center tablet:gap-3.5">
        <span
          className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] ${pillTone[status.tone]}`}
        >
          {status.label}
        </span>
        {onChain ? (
          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-03 px-[9px] py-1 text-label-13 text-02">
            {`On chain: ${onChain}`}
          </span>
        ) : null}
        <p className="min-w-0 flex-1 truncate font-mono text-mono-sm font-semibold text-01">
          {proposal.toolName}
          {proposal.windowLabel ? (
            <span className="text-03"> · window {proposal.windowLabel}</span>
          ) : null}
        </p>
        <p className="shrink-0 font-mono text-mono-12 text-03">
          {/*
            The design reads "delivered … · acknowledged … (dashboard)". The
            channel — "(dashboard)" — is NOT on the wire: `acknowledgedAt` is a
            timestamp and nothing records which surface it came from. It is
            dropped rather than guessed.
          */}
          {clocks.notifiedAt
            ? `delivered ${stampUtc(clocks.notifiedAt)}`
            : "delivery not yet confirmed"}
          {" · "}
          {clocks.acknowledgedAt
            ? `acknowledged ${stampUtc(clocks.acknowledgedAt)}`
            : "not yet acknowledged"}
        </p>
      </div>

      {/* ── Figures ──────────────────────────────────────────────────── */}
      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:gap-6">
        <Figure
          label="Proposed penalty"
          value={formatMoney(proposal.penaltyAmount)}
          caption="taken from stake, not from earnings already paid"
        />
        <Figure {...waiting} />
        <Figure {...executes} />
      </div>
    </section>
  );
}
