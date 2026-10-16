"use client";

import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { debtCauseText } from "@/features/call-classes/labels";
import { useEntityNames } from "@/hooks/useEntityNames";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { debtStateOf, splitDebts } from "./debt-copy";
import { debtBannerSummary } from "./debt-summary";
import { BUYER_DEBTS_KEY, useBuyerDebtsQuery, useSettleDebt } from "./settle-debt-sheet";

export { BUYER_DEBTS_KEY };

const ROW_STATE = { OPEN: null, REPLACING: "being collected", WRITTEN_OFF: "written off" } as const;

/**
 * The buyer-debt banner, mounted once in the buyer shell (see `BuyerBannerStack`
 * for its place among the other account banners).
 *
 * One line says what is owed and what it stops (paid calls), one short line
 * says the deadline or the write-off and that free calls still work, and one
 * button opens the settle sheet (`settle-debt-sheet.tsx`), where the person
 * sees what they sign, what it costs and the balance after. Which call, which
 * tool and why sit under Details. Nothing shows while nothing is owed or the
 * list cannot be read (an older backend has no such route).
 */
export function BuyerDebtBanner({ wrapperClassName }: { wrapperClassName?: string }) {
  const query = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const names = useEntityNames({ kinds: ["tool"] });

  const summary = debtBannerSummary(query.data);
  if (!summary) return null;
  const { own, others } = splitDebts(query.data);
  const all = [...own, ...others];
  const collecting = summary.kind === "collecting";

  return (
    <div className={wrapperClassName}>
      <div
        role="region"
        aria-label={collecting ? "Payment being collected" : "Payment owed"}
        data-testid="buyer-debt-banner"
        data-kind={summary.kind}
        className={cn(
          "flex w-full flex-col gap-3 rounded-lg border px-4 py-3.5 tablet:flex-row tablet:items-start",
          collecting ? "border-primary-20 bg-primary-10" : "border-warning-20 bg-warning-10",
        )}
      >
        <div className="flex min-w-0 flex-1 gap-3">
          <TriangleAlert
            aria-hidden="true"
            className={cn("mt-0.5 size-[17px] shrink-0", collecting ? "text-primary-600" : "text-warning-600")}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-label-sm text-01 [overflow-wrap:anywhere]">{summary.title}</p>
            <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{summary.detail}</p>
            <details className="group text-body-13 text-02">
              <summary className="hit-area cursor-pointer select-none text-label-xs text-02 underline-offset-2 hover:underline">
                Details ({all.length === 1 ? "1 call" : `${all.length} calls`})
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {all.map((debt) => {
                  const state = ROW_STATE[debtStateOf(debt)];
                  const elsewhere = others.includes(debt);
                  return (
                    <li key={debt.intentId} className="[overflow-wrap:anywhere]">
                      <span className="font-mono text-mono-12 font-semibold text-01">
                        {formatMoney(debt.amount, { decimals: 4 })}
                      </span>{" "}
                      · <span className="font-mono text-mono-12">{names.name("tool", debt.toolId)}</span> ·{" "}
                      {debtCauseText(debt.cause)}
                      {state ? ` · ${state}` : ""}
                      {elsewhere ? " · another wallet" : ""}
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        </div>
        {summary.actionLabel ? (
          <Button size="sm" className="shrink-0 self-start tablet:self-center" onClick={() => openSettle()}>
            {summary.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
