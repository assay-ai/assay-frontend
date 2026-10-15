"use client";

import Link from "next/link";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { Button } from "@/components/ui/button";
import type { ArbiterDispute } from "@/interfaces/operator";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { disputeAmount } from "./arbiter";
import { DISPUTE_RED_FROM_DAY, disputeUrgency } from "./inbox";

/** The 30-day window of an on-chain dispute as a bar, red from day 20. */
export function DisputeProgress({ row, now, className }: { row: Pick<ArbiterDispute, "disputedAt" | "expiresAt">; now: number; className?: string }) {
  const urgency = disputeUrgency(row, now);
  return (
    <div className={cn("flex w-full min-w-0 items-center gap-3", className)}>
      <div
        role="meter"
        aria-label="Time used of the 30 days to rule"
        aria-valuemin={0}
        aria-valuemax={30}
        aria-valuenow={urgency.day ?? undefined}
        aria-valuetext={urgency.day === null ? urgency.label : `Day ${urgency.day + 1} of 30, ${urgency.label}`}
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-03"
      >
        <span
          className={cn("block h-full rounded-full", urgency.urgent ? "bg-danger-500" : "bg-primary-500")}
          style={{ width: `${Math.max(3, urgency.used * 100)}%` }}
        />
        {/* Where red starts. */}
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-04" style={{ left: `${(DISPUTE_RED_FROM_DAY / 30) * 100}%` }} />
      </div>
      <span className={cn("shrink-0 font-mono text-mono-12", urgency.urgent ? "text-danger-600" : "text-02")}>
        {urgency.day === null ? urgency.label : `Day ${Math.min(30, urgency.day + 1)} of 30 · ${urgency.label}`}
      </span>
    </div>
  );
}

/**
 * One disputed penalty in a list (Home, Penalties): who, how much, how long
 * is left, and the one way in — Rule (for whoever can) or the case.
 */
export function DisputeLine({
  row,
  providerName,
  now,
  canRule,
}: {
  row: ArbiterDispute;
  providerName: string;
  now: number;
  canRule: boolean;
}) {
  const amount = disputeAmount(row.chainId, row.penaltyAmount);
  return (
    <article
      data-inbox-row=""
      tabIndex={-1}
      className="flex w-full min-w-0 flex-col gap-2.5 rounded-xl border border-01 bg-01 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:flex-row tablet:items-center tablet:gap-5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-body-sm text-01">
          <span className="font-medium">{providerName}</span> disputed a{" "}
          <span className="font-mono">{amount ? formatMoney(amount) : "penalty"}</span>
          {amount ? " penalty" : ""}
          {row.disputedAt ? (
            <span className="text-03">
              {" "}
              · <LocalTime value={row.disputedAt} dateOnly />
            </span>
          ) : null}
        </p>
        <DisputeProgress row={row} now={now} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 tablet:flex-row">
        <Button variant="secondary" asChild className="w-full tablet:w-auto">
          <Link href={routes.operatorCase(row.proposalId)}>Open penalty</Link>
        </Button>
        {canRule ? (
          <Button asChild className="w-full tablet:w-auto" data-primary="">
            <Link href={`/operator/arbiter?focus=${encodeURIComponent(row.requestId)}`}>Rule</Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
