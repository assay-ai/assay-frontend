"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { buyerStatus, BUYER_COPY, disputeErrorText, disputeReasonLabel, fullDateTime, refundedBeforeDecision } from "@/features/call-disputes/model";
import { CallLink, callDisputeKeys, DisputeChip, DisputeTimeline, EvidencePanes, useNow } from "@/features/call-disputes/ui";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { getCallDispute, withdrawCallDispute, type CallDisputeDetail } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";
import { useChainTerms } from "@/hooks/useChainTerms";
import { fillTerms } from "@/libs/chain-terms";

/**
 * One report — `/spend/disputes/view?id=`: where it stands and when the next
 * thing happens (the provider's 24-hour reply, the decision by 72 hours, the
 * automatic uphold of a silent provider), the provider's reply and the
 * reviewer's reason, the refund — including a call refunded before any
 * decision because its provider was blocked — and the evidence captured.
 */
function ReportContent() {
  const { terms: chainTerms } = useChainTerms();
  const id = useSearchParams().get("id") ?? "";
  const queryClient = useQueryClient();
  const names = useEntityNames({ kinds: ["tool", "provider"] });
  const now = useNow(30_000);
  const report = useQuery({ queryKey: callDisputeKeys.one(id), queryFn: () => getCallDispute(id), enabled: Boolean(id), retry: 0 });
  const [confirming, setConfirming] = React.useState(false);
  const withdraw = useMutation({
    mutationFn: () => withdrawCallDispute(id),
    onSuccess: (updated) => {
      setConfirming(false);
      queryClient.setQueryData(callDisputeKeys.one(id), (old: CallDisputeDetail | undefined) => (old ? { ...old, ...updated } : old));
      void queryClient.invalidateQueries({ queryKey: callDisputeKeys.all });
      toast.success("Report withdrawn");
    },
    onError: (error) => toast.error(disputeErrorText(error)),
  });

  const frame = (children: React.ReactNode) => (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <Link href="/spend/disputes" className="inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
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
  const providerName = names.lookup("provider", d.providerId);
  const callAt = typeof d.evidence?.call?.createdAt === "string" ? d.evidence.call.createdAt : null;
  return frame(
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="break-all font-mono text-heading-md text-01">{d.toolId ? names.name("tool", d.toolId) : "Reported call"}</h1>
        {providerName || callAt ? (
          <p className="text-body-13 text-02" data-testid="report-call-line">
            {providerName ? `by ${providerName}` : null}
            {providerName && callAt ? " · " : null}
            {callAt ? `call on ${fullDateTime(callAt, now)}` : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <DisputeChip view={status} />
          <span className="text-body-13 text-03">
            {disputeReasonLabel(d)} · reported {fullDateTime(d.createdAt, now)}
            {amount ? ` · the call cost ${amount}` : ""}
          </span>
        </div>
        <p className="text-body-13 text-02">{status.detail}</p>
      </header>

      <section aria-label="Status" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-5 py-4" data-testid="report-timeline">
        <DisputeTimeline dispute={d} side="buyer" now={now} onElapsed={() => void report.refetch()} />
        <p className="text-body-xs text-03">
          Times are in UTC.{d.state === "OPEN" && d.refundGuaranteed && d.holdEndsAt ? ` ${fillTerms(BUYER_COPY.safetyNet, chainTerms)}` : ""}
        </p>
      </section>

      <dl className="grid w-full grid-cols-1 gap-4 rounded-xl border border-01 bg-01 px-5 py-4 tablet:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-body-xs text-03">What you said</dt>
          <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.note ?? d.reasonLabel}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-body-xs text-03">The provider&apos;s reply</dt>
          <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">
            {d.providerResponse ?? (d.state === "OPEN" ? (refundedBeforeDecision(d) ? "No reply needed: the provider was blocked." : "No reply yet.") : d.state === "WITHDRAWN" ? "No reply: you withdrew the report." : "The provider did not reply.")}
          </dd>
        </div>
        {d.resolutionNote ? (
          <div className="flex min-w-0 flex-col gap-1 tablet:col-span-2">
            <dt className="text-body-xs text-03">Why it was {d.state === "UPHELD" ? "accepted" : "not accepted"}</dt>
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
        {d.state === "OPEN" && !refundedBeforeDecision(d) ? (
          confirming ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Withdraw the report?">
              <span className="text-body-13 text-02">
                {d.refundGuaranteed
                  ? "Withdraw it? The call stays charged and the held payment goes to the provider."
                  : "Withdraw it? The payment was already collected, so nothing changes for your money: it only stops counting against the provider's quality."}
              </span>
              <Button variant="danger" size="sm" className="touch-target" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
                Withdraw
              </Button>
              <Button variant="ghost" size="sm" className="touch-target" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="touch-target" onClick={() => setConfirming(true)}>
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
