"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { buyerStatus, disputeErrorText } from "@/features/call-disputes/model";
import { CallLink, callDisputeKeys, DisputeChip, DisputeTimeline, EvidencePanes, useNow } from "@/features/call-disputes/ui";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { getCallDispute, withdrawCallDispute } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * One report — `/spend/disputes/view?id=`: where it stands and when the next
 * thing happens (the provider's 24-hour reply, the decision by 72 hours, the
 * automatic uphold of a silent provider), the provider's reply and the
 * reviewer's reason, the refund — including a call refunded before any
 * decision because its provider was blocked — and the evidence captured.
 */
function ReportContent() {
  const id = useSearchParams().get("id") ?? "";
  const queryClient = useQueryClient();
  const names = useEntityNames({ kinds: ["tool"] });
  const now = useNow(30_000);
  const report = useQuery({ queryKey: callDisputeKeys.one(id), queryFn: () => getCallDispute(id), enabled: Boolean(id), retry: 0 });
  const withdraw = useMutation({
    mutationFn: () => withdrawCallDispute(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: callDisputeKeys.all });
      toast.success("Report withdrawn");
    },
    onError: (error) => toast.error(disputeErrorText(error)),
  });
  const [confirming, setConfirming] = React.useState(false);

  const frame = (children: React.ReactNode) => (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <Link href="/spend/disputes" className="inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Reports
      </Link>
      {children}
    </div>
  );
  if (report.isPending) return frame(<PageState kind="loading" rows={5} label="Loading the report" />);
  if (report.isError || !report.data) {
    const missing = report.error instanceof ApiError && report.error.status === 404;
    return frame(
      <PageState
        kind={missing ? "empty" : "error"}
        title={missing ? "We could not find this report" : "This report could not be loaded"}
        description={missing ? "The link may be incomplete. Your reports are all listed under Reports." : disputeErrorText(report.error)}
        {...(missing ? { action: { label: "Open Reports", href: "/spend/disputes" } } : { onRetry: () => void report.refetch() })}
      />,
    );
  }
  const d = report.data;
  const status = buyerStatus(d, now);
  const amount = d.amount ? formatMoney(d.amount, { decimals: 4 }) : null;
  return frame(
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="break-all font-mono text-heading-md text-01">{d.toolId ? names.name("tool", d.toolId) : "Reported call"}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DisputeChip view={status} />
          <span className="text-body-13 text-03">
            {d.reasonLabel} · reported <UtcTime value={d.createdAt} midSentence />
            {amount ? ` · the call cost ${amount}` : ""}
          </span>
        </div>
        <p className="text-body-13 text-02">{status.detail}</p>
      </header>

      <section aria-label="Status" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-5 py-4" data-testid="report-timeline">
        <DisputeTimeline dispute={d} side="buyer" now={now} onElapsed={() => void report.refetch()} />
        <p className="text-body-xs text-03">{d.refundNotice} Times are in UTC.</p>
      </section>

      <dl className="grid w-full grid-cols-1 gap-4 rounded-xl border border-01 bg-01 px-5 py-4 tablet:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-body-xs text-03">What you said</dt>
          <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.note ?? d.reasonLabel}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-body-xs text-03">The provider&apos;s reply</dt>
          <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">
            {d.providerResponse ?? (d.state === "OPEN" ? "No reply yet." : "The provider did not reply.")}
          </dd>
        </div>
        {d.resolutionNote ? (
          <div className="flex min-w-0 flex-col gap-1 tablet:col-span-2">
            <dt className="text-body-xs text-03">Why it was {d.state === "UPHELD" ? "upheld" : "rejected"}</dt>
            <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.resolutionNote}</dd>
          </div>
        ) : null}
        {d.restoredAmount || d.refundAmount ? (
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-body-xs text-03">Refunded</dt>
            <dd className="font-mono text-mono-13 text-01">{formatMoney(d.restoredAmount ?? d.refundAmount, { decimals: 4 })}</dd>
          </div>
        ) : null}
      </dl>

      <details className="group rounded-xl border border-01 bg-01">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-label-13 text-02 hover:text-01">Request and response, as captured when you reported it</summary>
        <div className="px-5 pb-5">
          <EvidencePanes evidence={d.evidence} />
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <CallLink intentId={d.intentId} />
        {d.state === "OPEN" ? (
          confirming ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Withdraw the report?">
              <span className="text-body-13 text-02">Withdraw it? The call stays charged.</span>
              <Button variant="danger" size="sm" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
                Withdraw
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Withdraw the report
            </Button>
          )
        ) : null}
      </div>
    </>,
  );
}

export default function ReportPage() {
  return (
    <React.Suspense fallback={null}>
      <ReportContent />
    </React.Suspense>
  );
}
