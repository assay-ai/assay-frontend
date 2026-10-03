"use client";

import * as React from "react";

import { DASH, stampUtc } from "@/features/g34a/stats";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { formatMoney } from "@/utils/money";

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
 * queue cannot disagree.
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

export function StatusHeader({ data }: { data: SlashProposalCaseDetail }) {
  const { proposal } = data;
  const clocks = proposal.clocks;
  const status = STATUS_COPY[proposal.status] ?? {
    label: proposal.status.replace(/_/g, " "),
    tone: "primary" as const,
  };

  const respondBy = clocks.respondByAt;
  const left = remaining(clocks.secondsRemaining);

  return (
    <section className="flex w-full flex-col gap-5 rounded-xl border border-01 bg-01 p-4 shadow-soft tablet:px-5 tablet:py-[18px]">
      {/* ── Identity row ─────────────────────────────────────────────── */}
      <div className="flex w-full flex-col items-start gap-2.5 tablet:flex-row tablet:items-center tablet:gap-3.5">
        <span
          className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] ${pillTone[status.tone]}`}
        >
          {status.label}
        </span>
        <p className="min-w-0 flex-1 truncate font-mono text-mono-sm font-semibold text-01">
          {proposal.bindingLabel} {proposal.toolName}
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
        <Figure
          label="Respond by"
          value={respondBy ? `${stampUtc(respondBy)} UTC` : DASH}
          caption={
            respondBy
              ? (left ?? "the response window has closed")
              : "your clock starts when the notification is delivered, and delivery is not confirmed yet"
          }
          tone={respondBy && clocks.runningClock === "PROVIDER" ? "danger" : undefined}
        />
        <Figure
          label="Executes"
          value={`${stampUtc(clocks.earliestExecutionAt)} UTC`}
          caption="never before that deadline, even if you do nothing"
        />
      </div>
    </section>
  );
}
