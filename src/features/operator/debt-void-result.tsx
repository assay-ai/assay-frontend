"use client";

import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Chip } from "@/components/toolsets/toolset-bits";
import type { BuyerDebtVoidResult } from "@/services/operator-buyer-debts.service";

import { debtVoidSummary, skipReasonText } from "./buyer-debts";

/**
 * What an approved bulk void did (`buyer_debt.bulk_void`), under its result
 * card: the counts and totals, then one line per debt. Skipped ones first,
 * since they are the ones that may need a person; the voided ones fold away
 * when there are many.
 */
export function DebtVoidResultList({ result }: { result: BuyerDebtVoidResult }) {
  const skipped = result.items.filter((item) => item.result === "SKIPPED");
  const voided = result.items.filter((item) => item.result === "VOIDED");
  return (
    <section aria-label="Bulk void results" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 px-3.5 py-3" data-testid="debt-void-result">
      <p className="text-body-13 text-01">{debtVoidSummary(result)}</p>
      {skipped.length > 0 ? (
        <ul className="flex flex-col divide-y divide-01 rounded-md border border-01" aria-label="Skipped">
          {skipped.map((item) => (
            <li key={item.intentId} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-body-13">
              <Chip tone="warning">Skipped</Chip>
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
