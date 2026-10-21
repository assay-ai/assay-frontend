"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { disputeErrorText, providerStatus, replyDueAt, REPLY_MAX } from "@/features/call-disputes/model";
import { callDisputeKeys, DisputeChip, DisputeTimeline, EvidencePanes, useNow } from "@/features/call-disputes/ui";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { getProviderCallDispute, respondToCallDispute } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * One report about a call you served — `/provider/call-disputes/view?id=`:
 * what the buyer said (never who they are), the call as captured, your one
 * reply before the 24-hour deadline, and the decision.
 */
function ProviderReportContent() {
  const id = useSearchParams().get("id") ?? "";
  const queryClient = useQueryClient();
  const names = useProviderToolNames();
  const now = useNow(30_000);
  const [reply, setReply] = React.useState("");
  const report = useQuery({ queryKey: callDisputeKeys.providerOne(id), queryFn: () => getProviderCallDispute(id), enabled: Boolean(id), retry: 0 });
  const respond = useMutation({
    mutationFn: () => respondToCallDispute(id, reply.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(callDisputeKeys.providerOne(id), updated);
      void queryClient.invalidateQueries({ queryKey: callDisputeKeys.provider });
      setReply("");
      toast.success("Reply sent. An operator decides; the payment stays held until then.");
    },
  });

  const frame = (children: React.ReactNode) => (
    <>
      <Link href="/provider/call-disputes" className="inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Bad-result reports
      </Link>
      {children}
    </>
  );
  if (report.isPending) return frame(<PageState kind="loading" rows={5} label="Loading the report" />);
  if (report.isError || !report.data) {
    const missing = report.error instanceof ApiError && report.error.status === 404;
    return frame(
      <PageState
        kind={missing ? "empty" : "error"}
        title={missing ? "We could not find this report" : "This report could not be loaded"}
        description={missing ? "It may be about a call another provider served." : disputeErrorText(report.error)}
        {...(missing ? { action: { label: "Open reports", href: "/provider/call-disputes" } } : { onRetry: () => void report.refetch() })}
      />,
    );
  }
  const d = report.data;
  const status = providerStatus(d, now);
  const tool = names.toolName(d.toolId) ?? "A call you served";
  return frame(
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-heading-sm text-01 tablet:text-heading-md">{tool}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DisputeChip view={status} />
          <span className="text-body-13 text-03">
            {d.reasonLabel} · reported <UtcTime value={d.createdAt} midSentence />
            {d.amount ? ` · ${formatMoney(d.amount, { decimals: 4 })}` : ""}
          </span>
        </div>
        <p className="text-body-13 text-02">{status.detail}</p>
      </header>

      <section aria-label="Status" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-4">
        <DisputeTimeline dispute={d} side="provider" now={now} onElapsed={() => void report.refetch()} />
        <p className="text-body-xs text-03">
          {d.refundGuaranteed
            ? `The buyer reported it during the hold, so the payment is held until this is decided. If upheld, the buyer gets ${d.amount ? formatMoney(d.amount, { decimals: 4 }) : "it"} back and you are not paid for this call.`
            : "Reported after the hold: the payment was already collected. If upheld, it counts against this listing's quality."}{" "}
          Times are in UTC.
        </p>
      </section>

      <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-4">
        <h2 className="text-label-md text-01">What the buyer said</h2>
        <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.note ?? `${d.reasonLabel} (no note)`}</p>
      </section>

      <section className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="provider-reply">
        <h2 className="text-label-md text-01">Your reply</h2>
        {d.providerResponse ? (
          <>
            <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.providerResponse}</p>
            {d.providerRespondedAt ? (
              <p className="text-body-xs text-03">
                Sent <UtcTime value={d.providerRespondedAt} midSentence />
              </p>
            ) : null}
          </>
        ) : d.canRespond ? (
          <>
            <p className="text-body-13 text-02">
              One reply, by <UtcTime value={replyDueAt(d)} midSentence />. Say what your API returned and why; the operator and the buyer read it.
            </p>
            <Textarea value={reply} maxLength={REPLY_MAX} rows={4} onChange={(e) => setReply(e.target.value)} placeholder="What happened on your side?" aria-label="Your reply" />
            <span className="text-body-xs text-03">
              {reply.length} / {REPLY_MAX}. It can&apos;t be edited after it is sent.
            </span>
            {respond.isError ? (
              <p role="alert" className="text-body-13 text-danger-700">
                {disputeErrorText(respond.error)}
              </p>
            ) : null}
            <Button className="self-start" icon={<Send aria-hidden="true" />} loading={respond.isPending} disabled={reply.trim().length < 3} onClick={() => respond.mutate()}>
              Send reply
            </Button>
          </>
        ) : (
          <p className="text-body-13 text-03">{d.state === "OPEN" ? "The 24-hour reply window has closed." : "No reply was sent."}</p>
        )}
      </section>

      {d.resolutionNote ? (
        <section className="flex w-full flex-col gap-1.5 rounded-xl border border-01 bg-01 px-4 py-4">
          <h2 className="text-label-md text-01">Why it was {d.state === "UPHELD" ? "upheld" : "rejected"}</h2>
          <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.resolutionNote}</p>
        </section>
      ) : null}

      <details className="group rounded-xl border border-01 bg-01">
        <summary className="cursor-pointer select-none px-4 py-3.5 text-label-13 text-02 hover:text-01">Request and response, as captured when it was reported</summary>
        <div className="px-4 pb-4">
          <EvidencePanes evidence={d.evidence} />
        </div>
      </details>

      {d.bindingId ? (
        <Link href={routes.binding(d.bindingId)} className="inline-flex min-h-10 items-center self-start text-body-13 text-primary-600 hover:underline">
          Open the listing that served it
        </Link>
      ) : null}
    </>,
  );
}

export default function ProviderReportPage() {
  return (
    <React.Suspense fallback={null}>
      <ProviderReportContent />
    </React.Suspense>
  );
}
