"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { callPaymentNote } from "@/features/buyer-debt/debt-copy";
import { neverRan } from "@/features/buyer/call-outcome";
import type { CallDebt } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainStatus } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getToolCall } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

import { useToolNames } from "./use-tool-names";

/**
 * A payment link opened from a notification. Approving a payment by hand does
 * not exist yet (no decide endpoint), so this page shows the call's OUTCOME —
 * settled, not charged, or still being checked — with a link to its receipt,
 * never approve/decline buttons that cannot do anything. A call priced above
 * the budget is refused, and the budget is one tap away.
 */
const SETTLED = new Set(["SETTLED", "COMMITTED", "PAID"]);
const NOT_CHARGED = new Set(["REFUNDED", "VOIDED", "EXPIRED", "RELEASED", "FAILED_VERIFICATION"]);

export function outcomeOf(
  status: string,
  debt?: CallDebt | null,
  forfeited?: boolean,
  /** EXPIRED with nothing ever held (`neverRan`): it did not run, so "Not charged" would overstate it. */
  neverHeld?: boolean,
): { chip: StatusChipKey; headline: string } {
  // Buyer debt: served, but the payment could not be collected; paid calls stay paused until it is settled.
  if (debt === "OUTSTANDING" || debt === "WRITTEN_OFF") return { chip: "owed", headline: "Served, payment still owed" };
  // A voided debt or a forfeited payment stays SETTLED, but nothing was charged.
  if (debt === "VOIDED" || forfeited) return { chip: "not-charged", headline: "Not charged" };
  if (SETTLED.has(status)) return { chip: "charged", headline: "Already settled" };
  if (status === "EXPIRED" && neverHeld) return { chip: "not-run", headline: "Did not run" };
  if (NOT_CHARGED.has(status)) return { chip: "not-charged", headline: "Not charged" };
  return { chip: "checking", headline: "Still in progress" };
}

/**
 * Whether a failed read means "no such payment": a 404, or a 400 for an id
 * that is not even well formed (a mistyped or cut link). Anything else may be
 * temporary, so the page says to try again.
 */
export function paymentNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

export function PaymentLinkView({ callId }: { callId: string }) {
  const { nameOf } = useToolNames();
  const call = useQuery({
    queryKey: ["tool-call", callId],
    retry: false,
    enabled: callId !== "",
    queryFn: () => getToolCall(callId),
  });

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Payment</h1>
        <p className="text-body-13 text-02">A paid call from a link you were sent.</p>
      </header>
      {children}
    </div>
  );

  if (call.isPending && callId !== "") return shell(<PageState kind="loading" rows={2} label="Opening the payment" />);

  if (callId === "" || call.isError || !call.data) {
    const notFound = callId === "" || paymentNotFound(call.error);
    return shell(
      <PageState
        kind="empty"
        title={notFound ? "Payment not found" : "This link could not be opened"}
        description={
          notFound
            ? "No payment matches this link. It may be mistyped or too old. Your calls and their receipts are under Activity."
            : "Try again in a moment. Your calls and their receipts are under Activity."
        }
        action={{ label: "Open Activity", href: "/spend/calls" }}
      />,
    );
  }

  const data = call.data;
  const outcome = outcomeOf(data.status, data.debt, data.forfeited, neverRan(data));
  const charged = SETTLED.has(data.status) && outcome.chip === "charged";
  return shell(
    <section aria-label="Payment" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label-md text-01">{outcome.headline}</span>
        <StatusChip status={outcome.chip} />
      </div>
      <p className="font-mono text-[28px] font-semibold leading-tight text-01">
        {formatMoney(charged || outcome.chip === "not-charged" || outcome.chip === "not-run" ? data.charged : data.price, { decimals: 2 })}
      </p>
      <p className="text-body-13 text-02">
        {nameOf(data.toolId)} · {outcome.chip === "owed"
          ? "not collected yet"
          : outcome.chip === "not-charged" && SETTLED.has(data.status)
            ? "not charged"
            : outcome.chip === "not-run"
              ? "nothing was held or charged"
              : plainStatus(data.status)}
      </p>
      {callPaymentNote(data) ? <p className={outcome.chip === "owed" ? "text-body-13 text-warning-700" : "text-body-13 text-02"}>{callPaymentNote(data)}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild>
          <Link href={routes.receipt(data.intentId)}>See the receipt</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/limits">Spending limits</Link>
        </Button>
      </div>
      <p className="text-body-xs text-03">
        Payments can&apos;t be approved by hand yet. A call that costs more than your spending limits allow is refused,
        so you are never charged above them.
      </p>
    </section>,
  );
}
