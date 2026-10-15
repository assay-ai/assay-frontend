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
import { Deadline } from "./deadline";
import { DISPUTE_RED_FROM_DAY, disputeDayText, disputeUrgency } from "./inbox";

/**
 * The 30-day window of an on-chain dispute as a bar, red from day 20.
 * Lists use `Deadline` now; this stays for the Arbiter page until it moves.
 */
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
        aria-valuetext={disputeDayText(row, now)}
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-03"
      >
        <span
          className={cn("block h-full rounded-full", urgency.urgent ? "bg-danger-500" : "bg-primary-500")}
          style={{ width: `${Math.max(3, urgency.used * 100)}%` }}
        />
        {/* Where red starts. */}
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-04" style={{ left: `${(DISPUTE_RED_FROM_DAY / 30) * 100}%` }} />
      </div>
      <span className={cn("shrink-0 text-body-xs tabular-nums", urgency.urgent ? "text-danger-600" : "text-02")}>
        {disputeDayText(row, now)}
      </span>
    </div>
  );
}

/**
 * One disputed penalty as a row of a list (Home, Penalties): who and how
 * much (the link to the penalty), when it was disputed, how long is left,
 * and one button — Rule — for whoever can. Without it the whole row is the
 * link. The parent draws the bordered container and the dividers.
 *
 *   Northwind Geo · $28.47    disputed Sep 23    [alert] 7 days left · rule by Oct 23    [Rule]
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
  const caseHref = routes.operatorCase(row.proposalId);
  const name = (
    <>
      <span className="text-label-sm text-01">{providerName}</span>
      {amount ? <span className="text-label-sm tabular-nums text-01"> · {formatMoney(amount)}</span> : null}
    </>
  );
  const facts = (
    <>
      {row.disputedAt ? (
        <span className="text-body-xs text-03">
          disputed <LocalTime value={row.disputedAt} dateOnly />
        </span>
      ) : null}
      <Deadline kind="dispute" until={row.expiresAt} from={row.disputedAt} now={now} />
    </>
  );
  const rowClass =
    "flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 outline-none focus-visible:bg-02 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:flex-row tablet:items-center tablet:gap-4";

  if (!canRule) {
    return (
      <Link href={caseHref} data-inbox-row="" data-primary="" className={cn(rowClass, "hover:bg-02")}>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{name}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{facts}</span>
      </Link>
    );
  }

  return (
    <article data-inbox-row="" tabIndex={-1} className={rowClass}>
      <Link href={caseHref} className="min-w-0 flex-1 [overflow-wrap:anywhere] hover:underline">
        {name}
      </Link>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{facts}</span>
      <Button asChild size="sm" className="touch-target w-full sm:w-auto sm:self-end tablet:self-auto" data-primary="">
        <Link href={`/operator/arbiter?focus=${encodeURIComponent(row.requestId)}`}>Rule</Link>
      </Button>
    </article>
  );
}
