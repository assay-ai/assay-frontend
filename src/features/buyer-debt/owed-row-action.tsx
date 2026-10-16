"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { owedCallState } from "./debt-summary";
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
