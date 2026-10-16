"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import type { CallDebt } from "@/interfaces/buyer-debt";

import { debtDeadline, isReplaceable, notYetSettleSentence } from "./debt-copy";
import { debtBannerSummary, debtDeadlineLine, earliestWriteOff, owedCallState, owedRowText } from "./debt-summary";
import { useBuyerDebtsQuery, useSettleDebt } from "./settle-debt-sheet";
import { useReplaceableNow } from "./use-replaceable-now";

/**
 * Under an Owed call row (Overview, Calls): what is owed and the way out,
 * as a sibling of the row's link (a button inside a link is invalid HTML).
 * "Settle $2.50" opens the settle sheet for this one call; a call that is
 * signed already, or owed by another wallet, says so instead.
 */
export function OwedRowAction({
  intentId,
  debt,
  className,
}: {
  intentId: string;
  /** The row's own debt flag, so a written-off call says so (P3-3). */
  debt?: CallDebt | null;
  className?: string;
}) {
  const debts = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const state = owedCallState(debts.data, intentId);
  const now = useReplaceableNow(debts.data, debts.dataUpdatedAt);
  // Its original payment can still be collected on chain until `replaceableAt`.
  const notYet = state.kind === "settle" && !isReplaceable(state.debt, now);
  const noteId = React.useId();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-dashed border-warning-20 bg-warning-10/50 px-4 py-2 tablet:px-5",
        className,
      )}
    >
      <span id={noteId} className="min-w-0 flex-1 text-body-xs text-warning-700">
        {owedRowText(state, { pending: debts.isPending, callDebt: debt ?? null })}
        {notYet ? ` ${notYetSettleSentence(state.debt.replaceableAt, { now })}` : null}
      </span>
      {state.kind === "settle" ? (
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={notYet}
          aria-describedby={notYet ? noteId : undefined}
          onClick={() => openSettle(intentId)}
        >
          Settle {formatMoney(state.debt.amount, { decimals: 4 })}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * On an owed receipt: settle this call here, or say why there is nothing to
 * sign (signed and being collected, owed by another wallet, or no longer in
 * the debts list).
 */
export function OwedReceiptAction({ intentId }: { intentId: string }) {
  const debts = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const state = owedCallState(debts.data, intentId);
  const now = useReplaceableNow(debts.data, debts.dataUpdatedAt);
  const noteId = React.useId();
  if (state.kind === "settle") {
    const deadline = debtDeadlineLine(state.debt);
    const notYet = !isReplaceable(state.debt, now);
    return (
      <>
        {deadline ? (
          <p className="text-body-13 font-medium text-warning-700" data-testid="receipt-settle-by">
            {deadline}
          </p>
        ) : null}
        {notYet ? (
          <p id={noteId} className="text-body-13 text-02" data-testid="receipt-not-yet">
            {notYetSettleSentence(state.debt.replaceableAt, { now })}
          </p>
        ) : null}
        <Button
          size="sm"
          type="button"
          className="mt-1 self-start"
          disabled={notYet}
          aria-describedby={notYet ? noteId : undefined}
          onClick={() => openSettle(intentId)}
        >
          Settle {formatMoney(state.debt.amount, { decimals: 4 })}
        </Button>
      </>
    );
  }
  const text =
    state.kind === "collecting"
      ? "You signed it: it is being collected, and paid calls resume once it is."
      : state.kind === "other-wallet"
        ? `Another wallet of your organization owes it: sign in with that wallet to settle. ${debtDeadlineLine(state.debt) ?? ""}`.trim()
        : debts.isPending
          ? null
          : "Nothing to sign for it from this session right now.";
  return text ? <p className="text-body-xs text-02">{text}</p> : null;
}

/**
 * Owed on a summary screen (Spend): the figure stays in the headline; this
 * says what it stops and gives the way out — settle now (when this wallet can
 * sign), and the owed calls themselves.
 */
export function OwedSummaryAction({ owed, calls }: { owed: string; calls: number | null }) {
  const debts = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const now = useReplaceableNow(debts.data, debts.dataUpdatedAt);
  const summary = debtBannerSummary(debts.data, { now });
  const settleBy = earliestWriteOff(debts.data);
  const noteId = React.useId();
  return (
    <div
      data-testid="owed-summary-action"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5"
    >
      <p id={noteId} className="min-w-0 flex-1 text-body-13 text-warning-700">
        <span className="font-mono font-semibold">{owed}</span> owed
        {calls === null ? "" : ` for ${calls === 1 ? "1 call" : `${calls} calls`}`}: payment not collected, and paid calls
        are paused until it is settled.
        {settleBy ? ` Settle by ${debtDeadline(settleBy)}; after that it is written off, but still owed.` : ""}
        {summary?.waitingNote ? ` ${summary.waitingNote}` : ""}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" asChild>
          <Link href={routes.calls({ status: "owed" })}>See owed calls</Link>
        </Button>
        {summary?.actionLabel ? (
          <Button
            size="sm"
            type="button"
            disabled={summary.actionDisabled}
            aria-describedby={summary.actionDisabled && summary.waitingNote ? noteId : undefined}
            onClick={() => openSettle()}
          >
            {summary.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
