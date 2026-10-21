"use client";

import { Clock, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  SETTLE_STALLED_TEXT,
  SETTLE_WAIT_IDLE,
  type SettleRead,
  settleWaitAfterRead,
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
  atRisk,
  reasons,
  waiting,
  settled,
  stalled = false,
  onWait,
  onProceed,
  proceedLabel,
  busy = false,
}: {
  unsettled: UnsettledVouchers | null | undefined;
  /** The change would strand them: by the screen's own reckoning, or the backend said so. */
  atRisk: boolean;
  /** Why, when the screen could tell. */
  reasons: readonly StrandReason[];
  waiting: boolean;
  /** The person waited and nothing is left to settle. */
  settled: boolean;
  /** The wait ran out with payments still at risk: the agent is still paying. */
  stalled?: boolean;
  onWait: () => void;
  onProceed: () => void;
  proceedLabel: string;
  busy?: boolean;
}) {
  const line = unsettledLine(unsettled);
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
          {stalled ? (
            <p className="text-body-13 text-warning-700" data-testid="unsettled-stalled">
              {SETTLE_STALLED_TEXT}
            </p>
          ) : null}
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
              {waiting
                ? "Waiting for them to settle…"
                : stalled
                  ? "Wait again"
                  : "Wait for them to settle"}
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
 * The "wait for them to settle" loop (see `settleWaitAfterRead`): while
 * `waiting`, `refresh` runs every `intervalMs` — it must re-read the SAME query
 * (no new cache entry per tick, no overlapping fetch). Every answered read is
 * fed through the pure step, so the wait ends when the figures stop stranding
 * anything, ignores reads answered before a refusal, and gives up with
 * `stalled` when the agent keeps paying.
 */
export function useSettleWait(read: SettleRead, refresh: () => void, intervalMs: number) {
  const [state, setState] = React.useState(SETTLE_WAIT_IDLE);
  React.useEffect(() => {
    if (!state.waiting) return;
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [state.waiting, refresh, intervalMs]);
  const { count, strands, readAt } = read;
  React.useEffect(() => {
    setState((previous) => settleWaitAfterRead(previous, { count, strands, readAt }, Date.now()));
  }, [count, strands, readAt]);
  const reset = React.useCallback(() => setState(SETTLE_WAIT_IDLE), []);
  return {
    waiting: state.waiting,
    settled: state.settled,
    stalled: state.stalled,
    /** A refusal no later read has answered yet: the warning stays up. */
    refused: state.refusedAt !== null,
    wait: () => {
      setState((previous) => ({
        ...previous,
        waiting: true,
        startedAt: Date.now(),
        settled: false,
        stalled: false,
      }));
      refresh();
    },
    markRefused: () => {
      setState((previous) => ({ ...previous, refusedAt: Date.now(), settled: false }));
      refresh();
    },
    reset,
  };
}
