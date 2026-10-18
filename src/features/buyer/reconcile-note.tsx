"use client";

import { Info, TriangleAlert } from "lucide-react";

import { SUPPORT_URL } from "@/libs/support";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import type { WithheldForAsset } from "./wire";

/**
 * The one sentence about whether the not-charged total matches the balance
 * history, shared by Not charged (/guarantee) and Statements so the two pages
 * can never say different things about the same month.
 *
 * The API checks `Σ HOLD_RELEASE == withheld + settlement remainders + orphans`.
 * A POSITIVE difference means more money was released back to the buyer than
 * the not-charged calls explain (a written-off pay-later call: its hold was
 * released, but it is still owed, so it is not "not charged"). Forfeited,
 * voided-debt and absorbed calls used to land here too; they are the
 * `NOT_COLLECTED` line now (UX review 2026-10-18, P0-3). Money returned, never
 * money taken, so it is an info line, not an alarm. A NEGATIVE difference means less was released than the total
 * claims, and that one is a warning with support.
 */
export type ReconcileState = "matches" | "more-released" | "less-released" | "unknown";

export function reconcileState(withheld: WithheldForAsset | null | undefined): ReconcileState {
  if (!withheld) return "unknown";
  if (withheld.ok) return "matches";
  let difference: bigint;
  try {
    difference = BigInt(withheld.difference);
  } catch {
    return "unknown";
  }
  if (difference === 0n) return "matches";
  return difference > 0n ? "more-released" : "less-released";
}

export const MATCHES_SENTENCE = "Matches your balance history exactly.";

export function ReconcileNote({
  withheld,
  className,
}: {
  withheld: WithheldForAsset | null | undefined;
  className?: string;
}) {
  const state = reconcileState(withheld);
  if (!withheld || state === "matches" || state === "unknown") return null;
  const amount = formatMoney({ ...withheld.holdReleaseTotal, amount: withheld.difference.replace(/^-/, "") });
  const warning = state === "less-released";

  return (
    <div
      role={warning ? "alert" : "note"}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3.5",
        warning ? "border-warning-20 bg-warning-10" : "border-01 bg-02",
        className,
      )}
    >
      {warning ? (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label-13 text-01">
          {warning ? "Some released money is missing from your balance history" : "Your balance history has more released money than this total"}
        </p>
        <p className="text-body-13 text-02">
          {warning
            ? `Your balance history shows ${amount} less released than the calls not charged this month. Contact support and keep this month's statement.`
            : `Holds released back to you this month come to ${amount} more than the calls not charged. Released money goes back to your balance, so this never means you paid more; it is usually a pay-later call that is still owed after its hold was released.`}
          {SUPPORT_URL ? (
            <>
              {" "}
              <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="text-primary-600 underline-offset-2 hover:underline">
                Contact support
              </a>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
