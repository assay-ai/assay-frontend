"use client";

import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import type { Receipt } from "@/features/g30/wire";
import { routes } from "@/libs/routes";
import { listCallDisputes } from "@/services/call-disputes.service";

import { buyerStatus, reportWindow } from "./model";
import { callDisputeKeys, DisputeChip, ReportSheet, useNow } from "./ui";

/**
 * The receipt's "Report a bad result": what a report filed now would mean
 * (inside the 1-hour hold: a full refund if upheld; after it: a quality
 * signal), the button, and once reported, the report's status with a link
 * to its timeline.
 */
export function ReceiptReport({ receipt, toolName }: { receipt: Receipt; toolName: string }) {
  const router = useRouter();
  const now = useNow(30_000);
  const [open, setOpen] = React.useState(false);
  const reports = useQuery({
    queryKey: callDisputeKeys.forIntent(receipt.intentId),
    queryFn: () => listCallDisputes({ intentId: receipt.intentId, limit: 5 }),
    retry: 0,
  });
  const latest = [...(reports.data?.items ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
  const hold = reportWindow(receipt, now);
  const openReport = latest && latest.state === "OPEN" ? latest : null;

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
