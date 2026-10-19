"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { usePauseAll } from "@/components/buyer-money/pause-all";
import { useFreeOnlyChain } from "@/components/buyer-money/use-buyer-money";
import { Button } from "@/components/ui/button";
import { debtCauseText } from "@/features/call-classes/labels";
import { useEntityNames } from "@/hooks/useEntityNames";
import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { demoDebtNote } from "@/libs/demo/demo-debts";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { debtStateOf, splitDebts } from "./debt-copy";
import { debtBannerSummary } from "./debt-summary";
import { BUYER_DEBTS_KEY, useBuyerDebtsQuery, useSettleDebt } from "./settle-debt-sheet";
import { useReplaceableNow } from "./use-replaceable-now";

export { BUYER_DEBTS_KEY };

/** One Details row: amount · tool · cause, then its state and whose wallet. */
function DebtRowText({
  debt,
  toolName,
  state,
  elsewhere = false,
}: {
  debt: BuyerDebt;
  toolName: string;
  state: string | null;
  elsewhere?: boolean;
}) {
  return (
    <>
      <span className="font-mono text-mono-12 font-semibold text-01">{formatMoney(debt.amount, { decimals: 4 })}</span> ·{" "}
      <span className="font-mono text-mono-12">{toolName}</span> · {debtCauseText(debt.cause)}
      {state ? ` · ${state}` : ""}
      {elsewhere ? " · another wallet" : ""}
    </>
  );
}

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
 * list cannot be read.
 */
/**
 * `compact`: one line (the title) and the action, for pages whose own content
 * must come first (Connect, tool sets, Agents): the detail stays one click
 * away under Details.
 */
export function BuyerDebtBanner({ wrapperClassName, compact = false }: { wrapperClassName?: string; compact?: boolean }) {
  const query = useBuyerDebtsQuery();
  const { openSettle } = useSettleDebt();
  const names = useEntityNames({ kinds: ["tool"] });

  const { paused } = usePauseAll();
  const { freeOnly } = useFreeOnlyChain();

  // A debt before its `replaceableAt` cannot be signed yet; this moves on at that time.
  const now = useReplaceableNow(query.data, query.dataUpdatedAt);
  const noteId = React.useId();
  const [open, setOpen] = React.useState(false);
  const summary = debtBannerSummary(query.data, { pausedByYou: paused, freeOnly, now });
  if (!summary) return null;
  const { own, others } = splitDebts(query.data);
  const all = [...own, ...others];
  const collecting = summary.kind === "collecting";
  // DEMO ONLY: a `?debt=` picture follows the tab across pages; say it is one.
  const demoNote = demoDebtNote();

  if (compact) {
    return (
      <div className={wrapperClassName}>
        <div
          role="region"
          aria-label={collecting ? "Payment being collected" : "Payment owed"}
          data-testid="buyer-debt-banner"
          data-kind={summary.kind}
          data-compact=""
          className={cn("flex w-full flex-col rounded-lg border px-3 py-1.5", collecting ? "border-primary-20 bg-primary-10" : "border-warning-20 bg-warning-10")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <TriangleAlert aria-hidden="true" className={cn("size-4 shrink-0", collecting ? "text-primary-600" : "text-warning-600")} />
            <p className="min-w-0 flex-1 truncate text-label-13 text-01" title={summary.title}>
              {summary.title}
            </p>
            <button
              type="button"
              aria-expanded={open}
              className="shrink-0 text-label-xs text-02 underline-offset-2 hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              Details
            </button>
            {summary.actionLabel ? (
              <Button size="sm" className="shrink-0" disabled={summary.actionDisabled} onClick={() => openSettle()}>
                {summary.actionLabel}
              </Button>
            ) : null}
          </div>
          {open ? (
            <div className="flex flex-col gap-1.5 pb-1.5 pl-6 pt-1 text-body-13 text-02">
              <p className="[overflow-wrap:anywhere]">{summary.detail}</p>
              {summary.waitingNote ? <p className="[overflow-wrap:anywhere]">{summary.waitingNote}</p> : null}
              <ul className="flex flex-col gap-1">
                {all.map((debt) => (
                  <li key={debt.intentId} className="[overflow-wrap:anywhere]">
                    <DebtRowText debt={debt} toolName={names.name("tool", debt.toolId)} state={ROW_STATE[debtStateOf(debt)]} elsewhere={others.includes(debt)} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

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
            {summary.waitingNote ? (
              <p id={noteId} data-testid="buyer-debt-not-yet" className="text-body-13 text-02 [overflow-wrap:anywhere]">
                {summary.waitingNote}
              </p>
            ) : null}
            {demoNote ? (
              <p className="text-body-xs text-03 [overflow-wrap:anywhere]" data-testid="buyer-debt-demo-note">
                {demoNote}
              </p>
            ) : null}
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
                      {elsewhere ? (
                        // Another wallet's call: only that wallet's session reads its receipt.
                        <DebtRowText debt={debt} toolName={names.name("tool", debt.toolId)} state={state} elsewhere />
                      ) : (
                        <Link
                          href={routes.receipt(debt.intentId)}
                          data-testid="buyer-debt-row-link"
                          className="inline-flex min-h-10 items-center underline-offset-2 hover:underline focus-visible:underline"
                          aria-label={`Receipt for the ${formatMoney(debt.amount, { decimals: 4 })} call to ${names.name("tool", debt.toolId)}`}
                        >
                          <DebtRowText debt={debt} toolName={names.name("tool", debt.toolId)} state={state} />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        </div>
        {summary.actionLabel ? (
          <Button
            size="sm"
            className="shrink-0 self-start tablet:self-center"
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
