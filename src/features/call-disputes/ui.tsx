"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { StatusTimeline } from "@/components/patterns/status-timeline";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CodePane } from "@/features/g30/receipt-parts";
import { routes } from "@/libs/routes";
import { fileCallDispute, type CallDispute, type CallDisputeEvidence, type CallDisputeReason } from "@/services/call-disputes.service";
import { cn } from "@/utils";

import { callDisputeKeys } from "./keys";
import { toast } from "@/utils/toast";

import {
  BUYER_COPY,
  DEADLINE_SENTENCE,
  disputeErrorText,
  disputeTimeline,
  filedToast,
  NOTE_MAX,
  REASON_OPTIONS,
  reasonLabel,
  type DisputeStatusView,
  type ReportWindowView,
} from "./model";

/**
 * The parts of "Report a bad result" every side shares: the status chip,
 * the timeline, the captured request and response, and the buyer's report
 * sheet.
 */

export { callDisputeKeys };

export function DisputeChip({ view }: { view: DisputeStatusView }) {
  const tone = view.tone === "teal" ? "success" : view.tone;
  return <Chip tone={tone}>{view.label}</Chip>;
}

/** The clock in the 40 px-friendly stepper: reported, reply, decision, refund. */
export function DisputeTimeline({ dispute, side, now, onElapsed }: { dispute: CallDispute; side: "buyer" | "provider" | "operator"; now: number; onElapsed?: () => void }) {
  return <StatusTimeline steps={disputeTimeline(dispute, now, side)} label="Report status" alwaysDay onElapsed={onElapsed} />;
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return JSON.stringify(value, null, 2);
}

/** What the decision rests on: the call's request and response as captured when it was reported. */
export function EvidencePanes({ evidence }: { evidence: CallDisputeEvidence | null | undefined }) {
  if (!evidence || (evidence.request === undefined && evidence.response === undefined)) {
    return <p className="text-body-13 text-03">The request and response were not kept for this call.</p>;
  }
  return (
    <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
      <CodePane label="REQUEST" body={pretty(evidence.request)} />
      <CodePane label="RESPONSE" body={pretty(evidence.response)} />
    </div>
  );
}

/** A small "now" that moves every minute, for deadlines and countdowns. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * "Report a bad result": a reason from a short list and a note, on a call
 * that was charged. Says first what a report filed now means for the money.
 */
export function ReportSheet({
  open,
  onOpenChange,
  intentId,
  toolName,
  hold,
  onFiled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intentId: string;
  toolName: string;
  hold: ReportWindowView;
  onFiled?: (dispute: CallDispute) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState<CallDisputeReason | null>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setReason(null);
      setNote("");
    }
  }, [open]);
  const file = useMutation({
    mutationFn: () => fileCallDispute({ subjectType: "PAYMENT_INTENT", subjectId: intentId, reason: reason!, ...(note.trim() ? { note: note.trim().slice(0, NOTE_MAX) } : {}) }),
    onSuccess: (dispute) => {
      void queryClient.invalidateQueries({ queryKey: callDisputeKeys.all });
      // When it is answered and decided by; never the outcome, which nobody has decided yet.
      toast.success(filedToast(dispute));
      onFiled?.(dispute);
      onOpenChange(false);
    },
  });
  const needsNote = reason === "OTHER" && note.trim().length < 3;
  const hint = REASON_OPTIONS.find((r) => r.value === reason)?.hint;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>Report a bad result</SheetTitle>
          <SheetDescription>
            On this call to <span className="break-all font-mono text-mono-12">{toolName}</span>.{" "}
            {/* The automatic acceptance only exists for a report the refund guarantee covers. */}
            {hold.guaranteed ? `${DEADLINE_SENTENCE.buyer} ${BUYER_COPY.decides}` : `${BUYER_COPY.reply} ${BUYER_COPY.decides}`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3" data-testid="report-sheet">
          <p className={cn("rounded-lg px-3 py-2.5 text-body-13", hold.guaranteed ? "bg-success-10 text-success-700" : "bg-warning-10 text-warning-700")}>
            {hold.text}
            {hold.holdEndsAt ? (
              <>
                {" "}
                The hold ends <UtcTime value={hold.holdEndsAt} midSentence />.
              </>
            ) : null}
          </p>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-label-13 text-01">What was wrong?</legend>
            {REASON_OPTIONS.map((option) => (
              <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md border border-02 px-3 text-body-13 text-01">
                <input type="radio" name="report-reason" className="accent-primary-500" checked={reason === option.value} onChange={() => setReason(option.value)} />
                {option.label}
              </label>
            ))}
            {/* The hint's line is always there, so the options never move when it appears. */}
            <p className="min-h-[2.5em] text-body-xs text-03">{hint ?? "Pick the one that fits best."}</p>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-13 text-01">{reason === "OTHER" ? "What was wrong" : "Anything else (optional)"}</span>
            <Textarea value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="What did you expect, and what came back?" />
            <span className="text-body-xs text-03">
              {note.length} / {NOTE_MAX}. The provider reads it; it never shows who you are.
            </span>
          </label>
          {file.isError ? (
            <p role="alert" className="text-body-13 text-danger-700">
              {disputeErrorText(file.error)}
            </p>
          ) : null}
          <p className="text-body-xs text-03">
            {BUYER_COPY.limit}
            {hold.guaranteed ? ` ${BUYER_COPY.held}` : ""}
          </p>
          {reason ? (
            <p className="text-body-13 text-01" data-testid="report-summary">
              Reporting: <span className="text-label-13">{reasonLabel(reason)}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button icon={<Flag aria-hidden="true" />} loading={file.isPending} disabled={!reason || needsNote} onClick={() => file.mutate()}>
              Send report
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The link from a report back to its call. */
export function CallLink({ intentId }: { intentId: string }) {
  return (
    <Link href={routes.receipt(intentId)} className="inline-flex min-h-10 items-center text-body-13 text-primary-600 hover:underline">
      Open the call
    </Link>
  );
}
