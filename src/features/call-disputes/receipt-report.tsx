"use client";

import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { refundableUntil } from "@/features/g30/receipt-state";
import type { Receipt } from "@/features/g30/wire";
import { formatRemaining } from "@/hooks/useCountdown";
import { routes } from "@/libs/routes";
import { listCallDisputes } from "@/services/call-disputes.service";

import { buyerStatus, reportWindow, type ReportWindowView } from "./model";
import { callDisputeKeys, DisputeChip, ReportSheet, useNow } from "./ui";

/**
 * What a report filed after the 1-hour hold leads to, said concretely (owner
 * decision D9): no refund, a mark on the provider's quality, and possibly a
 * penalty on their stake.
 */
export const AFTER_HOLD_TEXT =
  "The 1-hour hold has ended. No refund. Your report counts against the provider's quality and can lead to a penalty on their stake.";

/** The report window on a receipt, with the after-hold outcome in plain words. */
export function receiptHold(receipt: Receipt, now: number): ReportWindowView {
  const hold = reportWindow(receipt, now);
  return hold.open && !hold.guaranteed ? { ...hold, text: AFTER_HOLD_TEXT } : hold;
}

function useCallReports(intentId: string) {
  return useQuery({
    queryKey: callDisputeKeys.forIntent(intentId),
    queryFn: () => listCallDisputes({ intentId, limit: 5 }),
    retry: 0,
  });
}

/**
 * Beside the receipt's headline while the call is still refundable: how long
 * is left, and "Report a bad result" right there rather than at the foot of
 * the page. Nothing once the hour is over or the call is reported (the
 * report's status is shown further down).
 */
export function RefundableNow({ receipt, toolName }: { receipt: Receipt; toolName: string }) {
  const router = useRouter();
  const now = useNow(30_000);
  const [open, setOpen] = React.useState(false);
  const reports = useCallReports(receipt.intentId);
  const hold = receiptHold(receipt, now);
  const until = refundableUntil(receipt, now);
  if (!hold.guaranteed || !hold.holdEndsAt || !until) return null;
  if ((reports.data?.items?.length ?? 0) > 0) return null;
  const left = formatRemaining(Date.parse(hold.holdEndsAt) - now);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1.5" data-testid="receipt-refundable">
      <p className="text-body-13 text-02">
        {until} · {left} left to report it for a full refund.
      </p>
      <Button size="sm" variant="primary" icon={<Flag aria-hidden="true" />} disabled={reports.isPending} className="touch-target" onClick={() => setOpen(true)}>
        Report a bad result
      </Button>
      <ReportSheet open={open} onOpenChange={setOpen} intentId={receipt.intentId} toolName={toolName} hold={hold} onFiled={(d) => router.push(routes.callDispute(d.id))} />
    </div>
  );
}

/**
 * The receipt's "Report a bad result": what a report filed now would mean
 * (inside the 1-hour hold: a full refund if accepted; after it: no refund, a
 * quality signal that can lead to a penalty on the provider's stake), the button, and once reported, the report's status with a link
 * to its timeline.
 */
export function ReceiptReport({ receipt, toolName }: { receipt: Receipt; toolName: string }) {
  const router = useRouter();
  const now = useNow(30_000);
  const [open, setOpen] = React.useState(false);
  const reports = useCallReports(receipt.intentId);
  const latest = [...(reports.data?.items ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
  const hold = receiptHold(receipt, now);
  const openReport = latest && latest.state === "OPEN" ? latest : null;

  // The API says when a call can't be reported at all (not settled, free, your own): no button then.
  if (!latest && !receipt.disputeFilingClosesAt) return null;

  if (latest) {
    const status = buyerStatus(latest, now);
    return (
      <section aria-labelledby="report-title" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-5 py-4" data-testid="receipt-report">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="report-title" className="text-label-md text-01">
            You reported this call
          </h2>
          <DisputeChip view={status} />
        </div>
        <p className="text-body-13 text-02">
          {latest.reasonLabel} · <UtcTime value={latest.createdAt} /> · {status.detail}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm" className="touch-target">
            <Link href={routes.callDispute(latest.id)}>See the report</Link>
          </Button>
          {!openReport && hold.open ? (
            <Button variant="ghost" size="sm" className="touch-target" icon={<Flag aria-hidden="true" />} onClick={() => setOpen(true)}>
              Report it again
            </Button>
          ) : null}
        </div>
        <ReportSheet open={open} onOpenChange={setOpen} intentId={receipt.intentId} toolName={toolName} hold={hold} onFiled={(d) => router.push(routes.callDispute(d.id))} />
      </section>
    );
  }

  return (
    <section aria-labelledby="report-title" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-5 py-4 tablet:flex-row tablet:items-center tablet:justify-between" data-testid="receipt-report">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="report-title" className="text-label-md text-01">
          Bad result?
        </h2>
        <p className="text-body-13 text-02">
          {hold.text}
          {hold.holdEndsAt ? (
            <>
              {" "}
              Held until <UtcTime value={hold.holdEndsAt} midSentence />.
            </>
          ) : null}
        </p>
      </div>
      <Button variant={hold.guaranteed ? "primary" : "secondary"} icon={<Flag aria-hidden="true" />} disabled={!hold.open || reports.isPending} className="self-start tablet:self-auto" onClick={() => setOpen(true)}>
        Report a bad result
      </Button>
      <ReportSheet open={open} onOpenChange={setOpen} intentId={receipt.intentId} toolName={toolName} hold={hold} onFiled={(d) => router.push(routes.callDispute(d.id))} />
    </section>
  );
}
