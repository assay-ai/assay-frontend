"use client";

import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Chip } from "@/components/toolsets/toolset-bits";
import type { BuyerDebtVoidRecord } from "@/services/operator-buyer-debts.service";
import { formatMoney } from "@/utils/money";

import { debtVoidSummary, partialRunText, skipReasonText } from "./buyer-debts";

/**
 * What an approved bulk void did (`buyer_debt.bulk_void`): right after the
 * approve, and later from the record kept on the approval (its details, in
 * History too). The counts and totals voided and skipped, a notice when the
 * run stopped part way, then one line per debt. Skipped ones first, since
 * they are the ones that may need a person; the voided ones fold away when
 * there are many.
 */
export function DebtVoidResultList({ result }: { result: BuyerDebtVoidRecord }) {
  const skipped = result.items.filter((item) => item.result === "SKIPPED");
  const voided = result.items.filter((item) => item.result === "VOIDED");
  const money = (amount: string) => formatMoney({ amount, asset: result.assetId, decimals: result.decimals }, { decimals: 4 });
  return (
    <section aria-label="Bulk void results" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 px-3.5 py-3" data-testid="debt-void-result">
      <p className="text-body-13 text-01">{debtVoidSummary(result)}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-body-13 tabular-nums" aria-label="Counts">
        <dt className="text-02">Requested</dt>
        <dd className="text-01">
          {result.requestedCount} · {money(result.requestedAmount)}
        </dd>
        <dt className="text-02">Voided</dt>
        <dd className="text-01">
          {result.voidedCount} · {money(result.voidedAmount)}
        </dd>
        <dt className="text-02">Skipped</dt>
        <dd className="text-01">
          {result.skippedCount} · {money(result.skippedAmount)}
        </dd>
      </dl>
      {!result.complete ? (
        <p role="status" className="rounded-md border border-warning-20 bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="debt-void-partial">
          {partialRunText(result)}
        </p>
      ) : null}
      {skipped.length > 0 ? (
        <ul className="flex flex-col divide-y divide-01 rounded-md border border-01" aria-label="Skipped">
          {skipped.map((item) => (
            <li key={item.intentId} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-body-13">
              <Chip tone="warning">{item.skipReason === "NOT_ATTEMPTED" ? "Not attempted" : "Skipped"}</Chip>
              <CopyChip value={item.intentId} label="intent id" />
              <span className="min-w-0 text-02">{skipReasonText(item.skipReason)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {voided.length > 0 ? (
        <details className="rounded-md border border-01" open={voided.length <= 5}>
          <summary className="touch-target cursor-pointer px-3 py-2 text-label-13 text-02">Voided · {voided.length}</summary>
          <ul className="flex flex-col divide-y divide-01 border-t border-01" aria-label="Voided">
            {voided.map((item) => (
              <li key={item.intentId} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-body-13">
                <Chip tone="success">Voided</Chip>
                <CopyChip value={item.intentId} label="intent id" />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
