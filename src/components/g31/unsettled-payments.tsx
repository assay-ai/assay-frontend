"use client";

import { Clock, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  type StrandReason,
  strandWarning,
  unsettledLine,
} from "@/features/delegation/unsettled";
import type { UnsettledVouchers } from "@/interfaces";

/**
 * Payments still being settled, on a screen that changes the caps they will be
 * redeemed under (BUG-D1-07): the Edit limits and Revoke sheets, and the escrow
 * limits page.
 *
 * - Always: "N payments (X) still being settled", when there are any.
 * - When the change would strand them (`atRisk`): what that means,
 *   and the two ways on — wait for them to settle (the screen polls), or go
 *   ahead knowingly. The screen's own primary action stays disabled meanwhile,
 *   so the only way past is one of these two.
 * - After a wait that ended with nothing left: say so.
 */
export function UnsettledPayments({
  unsettled,
  unit,
  atRisk,
  reasons,
  waiting,
  settled,
  onWait,
  onProceed,
  proceedLabel,
  busy = false,
}: {
  unsettled: UnsettledVouchers | null | undefined;
  unit: string;
  /** The change would strand them: by the screen's own reckoning, or the backend said so. */
  atRisk: boolean;
  /** Why, when the screen could tell. */
  reasons: readonly StrandReason[];
  waiting: boolean;
  /** The person waited and nothing is left to settle. */
  settled: boolean;
  onWait: () => void;
  onProceed: () => void;
  proceedLabel: string;
  busy?: boolean;
}) {
  const line = unsettledLine(unsettled, unit);
  if (!line && !settled) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="unsettled-payments">
      {line ? (
        <p
          className="flex items-start gap-1.5 text-body-13 text-02"
          data-testid="unsettled-line"
        >
          <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {line}.
        </p>
      ) : null}
      {atRisk && unsettled ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 p-3"
          data-testid="unsettled-strand-warning"
          role="alert"
        >
          <p className="flex items-start gap-1.5 text-body-13 text-warning-700">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {strandWarning(reasons, unsettled.count)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="unsettled-wait"
              loading={waiting}
              disabled={waiting || busy}
              onClick={onWait}
            >
              {waiting ? "Waiting for them to settle…" : "Wait for them to settle"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              data-testid="unsettled-proceed"
              disabled={busy}
              onClick={onProceed}
            >
              {proceedLabel}
            </Button>
          </div>
        </div>
      ) : null}
      {settled && !line ? (
        <p className="text-body-13 text-success-700" data-testid="unsettled-settled">
          They have settled. You can sign now.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The "wait for them to settle" loop: while `waiting`, `refresh` runs every
 * `intervalMs`; once the count reaches zero the wait ends and `settled` turns
 * true. A refusal from the backend (`refused`) keeps the warning up until then
 * even when the local figures did not predict it.
 */
export function useSettleWait(
  count: number | undefined,
  refresh: () => void,
  intervalMs: number,
) {
  const [waiting, setWaiting] = React.useState(false);
  const [settled, setSettled] = React.useState(false);
  const [refused, setRefused] = React.useState(false);
  React.useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [waiting, refresh, intervalMs]);
  React.useEffect(() => {
    if ((waiting || refused) && count === 0) {
      setWaiting(false);
      setRefused(false);
      setSettled(true);
    }
  }, [waiting, refused, count]);
  const reset = React.useCallback(() => {
    setWaiting(false);
    setSettled(false);
    setRefused(false);
  }, []);
  return {
    waiting,
    settled,
    refused,
    wait: () => {
      setSettled(false);
      setWaiting(true);
      refresh();
    },
    markRefused: () => setRefused(true),
    reset,
  };
}
