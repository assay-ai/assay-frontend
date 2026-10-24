"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { DECISION_NOTE_MAX, DECISION_NOTE_MIN, disputeErrorText, refundPlanText, shortRef, slaMarks } from "@/features/call-disputes/model";
import { DisputeTimeline, EvidencePanes, useNow } from "@/features/call-disputes/ui";
import { collectionLabel } from "@/features/operator/dispute-money";
import { mayDecideCallDisputes } from "@/features/operator/provider-tool-review";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref } from "@/features/operator/two-person";
import { useOperatorDirectory, useOperatorToolNames, useProviderNames } from "@/features/operator/use-operator-lookups";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { decideOperatorCallDispute, getOperatorCallDispute, type OperatorCallDisputeDetail } from "@/services/operator-call-disputes.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * One call dispute — `/operator/disputes/view?id=` (S-14): the SLA marks,
 * the timeline, both sides' words, the call as captured, where the money is
 * now (what upholding would do), the buyer's recent record, and the decision.
 * An upheld refund at or above the threshold waits for a second operator.
 */
/** The intent's status and collection state in words (the API sends codes). */
const INTENT_STATUS: Readonly<Record<string, string>> = {
  SETTLED: "Settled (charged)",
  REFUNDED: "Refunded",
  VOIDED: "Voided (not charged)",
  EXPIRED: "Expired (not charged)",
};

function DisputeScreen() {
  const id = useSearchParam("id");
  const me = useOperatorSession();
  const now = useNow(30_000);
  const directory = useOperatorDirectory();
  const detail = useQuery({ queryKey: ["operator", "call-dispute", id], queryFn: () => getOperatorCallDispute(id), enabled: Boolean(id), retry: 0 });
  const [result, setResult] = React.useState<{ title: string; next: string; href?: string } | null>(null);
  const toolName = useOperatorToolNames();
  const providers = useProviderNames();
  const resultRef = React.useRef<HTMLDivElement | null>(null);
  // The confirmation lands where the button was, not at the top of the page.
  React.useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [result]);

  const back = (
    <Link href="/operator/disputes" className="inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Call disputes
    </Link>
  );
  if (detail.isPending) return <>{back}<PageState kind="loading" rows={6} label="Loading the dispute" /></>;
  if (detail.isError || !detail.data) {
    return (
      <>
        {back}
        <PageState kind="error" description={disputeErrorText(detail.error)} onRetry={() => void detail.refetch()} code={detail.error instanceof ApiError ? detail.error.code : null} />
      </>
    );
  }
  const d = detail.data;
  const marks = slaMarks(d, now);
  const plan = d.intent?.refundPlan ? refundPlanText(d.intent.refundPlan, d.state) : null;
  const h = d.buyerHistory;

  return (
    <>
      {back}
      <header className="flex flex-col gap-1.5">
        <h1 className="text-heading-md text-01">{d.reasonLabel}</h1>
        <p className="text-body-13 text-02 [overflow-wrap:anywhere]">
          On <span className="font-mono">{toolName(d.toolId)}</span>, served by {providers.lookup(d.providerId) ?? `Provider ${shortRef(d.providerId)}`}, for Buyer {shortRef(d.buyerOrganizationId)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-body-13 text-03">
          <Chip tone={d.state === "OPEN" ? "warning" : d.state === "UPHELD" ? "success" : "neutral"}>{d.state === "OPEN" ? "Open" : d.state === "UPHELD" ? "Upheld" : d.state === "REJECTED" ? "Rejected" : "Withdrawn"}</Chip>
          {marks.map((m) => (
            <Chip key={m.label} tone={m.tone}>
              {m.label}
            </Chip>
          ))}
          {d.needsSecondOperator ? <Chip tone="primary">Upholding needs a second operator</Chip> : null}
          <span>
            Filed <UtcTime value={d.createdAt} midSentence />
            {d.amount ? ` · ${formatMoney(d.amount, { decimals: 4 })}` : ""}
          </span>
        </div>
      </header>


      <section aria-label="Timeline" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-4">
        <DisputeTimeline dispute={d} side="operator" now={now} onElapsed={() => void detail.refetch()} />
        <p className="text-body-xs text-03">{d.refundGuaranteed ? "Filed inside the 1-hour hold: the payment is held; upholding refunds it in full." : "Filed after the hold: the payment was already collected. Upholding counts against quality; a refund is not guaranteed."} Times are in UTC.</p>
      </section>

      <div className="grid w-full grid-cols-1 gap-4 desktop:grid-cols-2">
        <section className="flex flex-col gap-1.5 rounded-xl border border-01 bg-01 px-4 py-4">
          <h2 className="text-label-md text-01">The buyer said</h2>
          <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.note ?? `${d.reasonLabel} (no note)`}</p>
          <p className="text-body-xs text-03">
            This buyer: {h.filedLastDay} filed today (limit {h.dailyLimit}) · {h.upheldLast30Days} upheld and {h.rejectedLast30Days} rejected in 30 days
            {h.flagged ? " · mostly rejected: the tighter limit applies" : ""}
          </p>
        </section>
        <section className="flex flex-col gap-1.5 rounded-xl border border-01 bg-01 px-4 py-4">
          <h2 className="text-label-md text-01">The provider replied</h2>
          <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.providerResponse ?? (d.canRespond ? "No reply yet; the window is open." : "No reply.")}</p>
          {d.providerRespondedAt ? (
            <p className="text-body-xs text-03">
              <UtcTime value={d.providerRespondedAt} />
            </p>
          ) : null}
        </section>
      </div>

      <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-4">
        <h2 className="text-label-md text-01">Where the money is</h2>
        {d.intent ? (
          <dl className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
            {[
              ["Call", INTENT_STATUS[d.intent.status] ?? d.intent.status],
              ["Payment", d.intent.rail === "RAIL_B_VOUCHER" ? "Escrow voucher" : "Paid at call time"],
              ["Price", formatMoney(d.intent.price, { decimals: 4 })],
              ["Collection", collectionLabel(d.intent, d.state)],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-body-xs text-03">{label}</dt>
                <dd className="truncate text-body-13 text-01">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {plan ? <p className="text-body-13 text-02">{plan}</p> : null}
        {d.refundState === "REFUNDED" && d.state === "OPEN" ? <p className="text-body-13 text-success-700">Already refunded: the provider was blocked and its held payment went back to the buyer. Decide for the quality record.</p> : null}
      </section>

      <details open className="group rounded-xl border border-01 bg-01">
        <summary className="cursor-pointer select-none px-4 py-3.5 text-label-13 text-02 hover:text-01">Request and response, as captured at filing</summary>
        <div className="px-4 pb-4">
          <EvidencePanes evidence={d.evidence} />
        </div>
      </details>

      {d.resolutionNote ? (
        <section className="flex flex-col gap-1 rounded-xl border border-01 bg-01 px-4 py-4">
          <h2 className="text-label-md text-01">Decision</h2>
          <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{d.resolutionNote}</p>
          <p className="text-body-xs text-03">
            {d.resolvedBy ? `By ${directory.nameOf(d.resolvedBy)}` : "Automatic"}
            {d.secondedBy ? `, approved by ${directory.nameOf(d.secondedBy)}` : ""}
            {d.resolvedAt ? (
              <>
                {" "}
                · <UtcTime value={d.resolvedAt} />
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      <div ref={resultRef}>
        {result ? <ResultCard title={result.title} next={result.next} tone={result.href ? "queued" : "done"} link={result.href ? { href: result.href, label: "Open it in Approvals" } : undefined} onDismiss={() => setResult(null)} /> : null}
      </div>

      {d.state === "OPEN" && mayDecideCallDisputes(me.roles) ? (
        <DecideForm
          dispute={d}
          onDone={(message) => {
            setResult(message);
            void detail.refetch();
          }}
        />
      ) : d.state === "OPEN" ? (
        <p className="text-body-13 text-03">Deciding needs an Adjudicator or a Lead adjudicator.</p>
      ) : null}
    </>
  );
}

function DecideForm({ dispute, onDone }: { dispute: OperatorCallDisputeDetail; onDone: (message: { title: string; next: string; href?: string }) => void }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = React.useState<"UPHOLD" | "REJECT" | null>(null);
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const tooShort = note.trim().length < DECISION_NOTE_MIN;
  // The money is moving (a voucher being redeemed, a held payment being collected): the server refuses for a minute.
  const moving = dispute.intent?.refundPlan === "COLLECTION_IN_PROGRESS";
  const run = useMutation({
    mutationFn: () => decideOperatorCallDispute(dispute.id, { decision: decision!, note: note.trim(), ...(ticket.trim() ? { ticketRef: ticket.trim() } : {}) }),
    onSuccess: (answer) => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "call-disputes"] });
      if (answer.kind === "queued") {
        onDone({ title: "Sent for approval: upholding this refund needs a second operator", next: "Nothing has happened yet: it is upheld, and the buyer refunded, once a second operator approves it in Approvals.", href: approvalHref(answer.approval.approvalId) });
      } else {
        onDone({ title: decision === "UPHOLD" ? "Upheld" : "Rejected", next: "The buyer and the provider are told, with your note." });
      }
    },
  });
  return (
    <section aria-labelledby="decide-title" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="dispute-decision">
      <h2 id="decide-title" className="text-label-md text-01">
        Decide
      </h2>
      <fieldset className="flex flex-col gap-2 tablet:flex-row">
        <legend className="sr-only">Decision</legend>
        {(["UPHOLD", "REJECT"] as const).map((d) => (
          <label key={d} className={cn("flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5", decision === d ? "border-primary-500 bg-primary-10" : "border-02")}>
            <input type="radio" name="dispute-decision" className="mt-1 accent-primary-500" checked={decision === d} onChange={() => setDecision(d)} />
            <span className="flex flex-col gap-0.5">
              <span className="text-label-13 text-01">{d === "UPHOLD" ? "Uphold: the result was bad" : "Reject: the result was fine"}</span>
              <span className="text-body-xs text-03">
                {d === "UPHOLD"
                  ? `${dispute.refundGuaranteed ? "Refunds the held payment" : "Refunds only if not collected"}; counts against the listing's quality.${dispute.needsSecondOperator ? " Needs a second operator." : ""}`
                  : "The payment is collected for the provider."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-label-13 text-01">Why (the buyer and the provider read this, word for word)</span>
        <textarea value={note} maxLength={DECISION_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-02 bg-01 px-3 py-2 text-body-13 text-01" />
        <span className={cn("text-body-xs", tooShort && note ? "text-danger-600" : "text-03")}>
          {note.trim().length} / {DECISION_NOTE_MIN} minimum
        </span>
      </label>
      <label className="flex flex-col gap-1.5 tablet:max-w-[320px]">
        <span className="text-label-13 text-01">Ticket (optional)</span>
        <input value={ticket} maxLength={128} onChange={(e) => setTicket(e.target.value)} className="min-h-10 rounded-md border border-02 bg-01 px-3 font-mono text-mono-12 text-01" />
      </label>
      {moving ? <p className="text-body-13 text-warning-700">The payment is moving right now. Wait a minute, then reload and decide.</p> : null}
      {run.isError ? (
        <p role="alert" className="rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
          {disputeErrorText(run.error)}
        </p>
      ) : null}
      <Button className="self-start" variant={decision === "REJECT" ? "danger" : "primary"} disabled={!decision || tooShort || moving} loading={run.isPending} onClick={() => run.mutate()}>
        {decision === "REJECT" ? "Reject" : dispute.needsSecondOperator ? "Ask a second operator to uphold" : "Uphold"}
      </Button>
    </section>
  );
}

export default function OperatorDisputePage() {
  return (
    <React.Suspense fallback={null}>
      <DisputeScreen />
    </React.Suspense>
  );
}
