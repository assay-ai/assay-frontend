"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState, SkeletonRows } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import {
  finishedWithdrawals,
  reconciliationLine,
  refundableLine,
  refundableSummary,
  withdrawalOutcome,
} from "@/features/buyer-money/funding-lines";
import type { BuyerEscrow } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { routes } from "@/libs/routes";
import { findChain } from "@/services/chains.service";
import { listWithdrawals } from "@/services/funding.service";
import { listToolCalls } from "@/services/tool-calls.service";
import { cn } from "@/utils";

import { useBuyerMoney } from "./use-buyer-money";

/**
 * Funding's result lines (B7): where the balance came from, what is still
 * refundable, and the withdrawals list. Each reads the API's own answer.
 */

/** "Deposited − spent − withdrawn = balance", from the chain's counters; nothing when they are not served. */
export function EscrowReconciliation({ escrow }: { escrow: BuyerEscrow }) {
  const line = reconciliationLine(escrow.lifetime, escrow.balance);
  if (!line) return null;
  return (
    <p className="text-body-xs text-03" data-testid="escrow-reconciliation">
      {line}, all time, as the escrow contract counts it. Month by month:{" "}
      <Link href="/statements" className="font-semibold text-primary-600 hover:underline">
        Statements
      </Link>
      .
    </p>
  );
}

/**
 * The calls a report filed now would refund in full, summed. The list is
 * `GET /tool-calls?refundable=true`, the receipt's own predicate, so this
 * never promises more than the receipt does. Nothing when there are none.
 */
export function RefundableNowLine() {
  const query = useQuery({
    queryKey: ["tool-calls", "refundable", "summary"],
    queryFn: () => listToolCalls({ refundable: true, limit: 100 }),
    retry: 0,
    // The answer lapses with the hold; read it again rather than keep an old promise.
    refetchInterval: 60_000,
  });
  const summary = refundableSummary(query.data?.items);
  if (!summary) return null;
  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success-20 bg-success-10 px-4 py-2.5"
      data-testid="funding-refundable"
    >
      <p className="min-w-0 flex-1 text-body-13 text-success-700">
        {refundableLine(summary)}
        {summary.soonestUntil ? (
          <>
            {" "}
            The first window closes <UtcTime value={summary.soonestUntil} midSentence />.
          </>
        ) : null}
      </p>
      <Link href={routes.calls({ status: "refundable" })} className="text-label-13 text-success-700 hover:underline">
        See them
      </Link>
    </div>
  );
}

/**
 * Withdrawals: the open request (from the escrow, live) is on the escrow card
 * with Claim / Cancel; this lists the finished ones from `GET /withdrawals`.
 */
export function WithdrawalsList({ pending }: { pending: boolean }) {
  const { chains } = useBuyerMoney();
  const query = useQuery({
    queryKey: ["withdrawals"],
    queryFn: () => listWithdrawals(),
    retry: 0,
    networkMode: "always" as const,
  });
  const items = finishedWithdrawals(query.data?.items);

  return (
    <section aria-label="Withdrawals" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
      <h2 className="text-label-md text-01">Withdrawals</h2>
      {pending ? (
        <p className="text-body-xs text-03">Your open request, with Claim and Cancel, is on the escrow card above.</p>
      ) : null}
      {query.isPending ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <PageState kind="error" title="Withdrawals could not be loaded" onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <p className="py-2 text-body-13 text-03">
          No finished withdrawals yet. Each one shows here a few minutes after it is claimed or cancelled.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-01" data-testid="withdrawals-list">
          {items.map((item) => {
            const outcome = withdrawalOutcome(item);
            const chain = findChain(chains, item.chainId);
            const hash = item.closeTransactionHash ?? item.requestTransactionHash;
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-mono-13 text-01">{outcome.amount}</span>
                  <span className="text-body-xs text-03">
                    {item.requestedAt ? (
                      <>
                        Requested <UtcTime value={item.requestedAt} midSentence />
                      </>
                    ) : (
                      "Requested earlier"
                    )}
                    {item.closedAt ? (
                      <>
                        {" · "}
                        {item.status === "CLAIMED" ? "claimed" : item.status === "CANCELLED" ? "cancelled" : "replaced"}{" "}
                        <UtcTime value={item.closedAt} midSentence />
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={cn("text-body-xs", outcome.tone === "success" ? "text-success-700" : "text-03")}>{outcome.label}</span>
                  {hash && chain ? (
                    <a
                      href={explorerTxUrl(chain, hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-label-xs text-02 hover:underline"
                      aria-label="View this withdrawal on the explorer"
                    >
                      Explorer
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
