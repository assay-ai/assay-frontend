"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { debtBannerSummary, owedCallState } from "./debt-summary";
import { useBuyerDebtsQuery, useSettleDebt } from "./settle-debt-sheet";

/**
 * Under an Owed call row (Overview, Calls): what is owed and the way out,
 * as a sibling of the row's link (a button inside a link is invalid HTML).
 * "Settle $2.50" opens the settle sheet for this one call; a call that is
 * signed already, or owed by another wallet, says so instead.
 */
export function OwedRowAction({ intentId, className }: { intentId: string; className?: string }) {
  const debts = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const state = owedCallState(debts.data, intentId);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-dashed border-warning-20 bg-warning-10/50 px-4 py-2 tablet:px-5",
        className,
      )}
    >
      <span className="min-w-0 flex-1 text-body-xs text-warning-700">
        {state.kind === "collecting"
          ? "Signed · being collected. Paid calls resume once it is."
          : state.kind === "other-wallet"
            ? "Owed by another wallet of your organization: sign in with it to settle."
            : "Payment not collected · paid calls paused until you settle."}
      </span>
      {state.kind === "settle" ? (
        <Button size="sm" variant="secondary" type="button" onClick={() => openSettle(intentId)}>
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
  if (state.kind === "settle") {
    return (
      <Button size="sm" type="button" className="mt-1 self-start" onClick={() => openSettle(intentId)}>
        Settle {formatMoney(state.debt.amount, { decimals: 4 })}
      </Button>
    );
  }
  const text =
    state.kind === "collecting"
      ? "You signed it: it is being collected, and paid calls resume once it is."
      : state.kind === "other-wallet"
        ? "Another wallet of your organization owes it: sign in with that wallet to settle."
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
export function OwedSummaryAction({ owed, calls }: { owed: string; calls: number }) {
  const debts = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const summary = debtBannerSummary(debts.data);
  return (
    <div
      data-testid="owed-summary-action"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5"
    >
      <p className="min-w-0 flex-1 text-body-13 text-warning-700">
        <span className="font-mono font-semibold">{owed}</span> owed for {calls === 1 ? "1 call" : `${calls} calls`}: its
        payment was not collected, and paid calls are paused until it is settled.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" asChild>
          <Link href={routes.calls({ status: "owed" })}>See owed calls</Link>
        </Button>
        {summary?.actionLabel ? (
          <Button size="sm" type="button" onClick={() => openSettle()}>
            {summary.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
