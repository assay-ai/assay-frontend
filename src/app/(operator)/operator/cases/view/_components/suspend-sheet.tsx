"use client";

import { History, PenLine, ShieldCheck, Undo2, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { approvalNeeds } from "@/features/operator/approvals";
import { eligibleApprovers } from "@/features/operator/inbox";
import { operatorErrorSentence } from "@/features/operator/operator-errors";
import { SUSPEND_REASONS } from "@/features/operator/reasons";
import { SHORT_NOTE_MIN_LENGTH } from "@/features/operator/reason-codes";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { approvalHref, type TwoPersonAnswer } from "@/features/operator/two-person";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import { ApiError } from "@/libs/ApiClient";
import { suspendCase } from "@/services/operator.service";

import { WhatHappens } from "./what-happens";

/**
 * Suspend a penalty: a reason chip, a note, and — when the penalty was
 * already upheld — who has to approve it. Cancels the penalty here and asks
 * for its on-chain cancel; the arbiter still signs that.
 */
export function SuspendSheet({
  open,
  onOpenChange,
  proposalId,
  penaltyText,
  twoPerson,
  me,
  waiting = null,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  penaltyText: string;
  twoPerson: boolean;
  me: Pick<OperatorIdentity, "id">;
  /** A suspension of this penalty already waiting for approval: a second one is not sent. */
  waiting?: OperatorApproval | null;
  /** The answer, and the reason that was picked (so the result card says it back). */
  onDone: (answer: TwoPersonAnswer<unknown>, reasonCode: string) => void;
}) {
  const directory = useOperatorDirectory();
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<{ sentence: string; code: string | null } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setErrors({});
      setFailure(null);
    }
  }, [open]);

  const submit = async () => {
    if (waiting) return;
    const next = {
      reason: reason ? undefined : "Pick a reason.",
      note:
        note.trim().length < SHORT_NOTE_MIN_LENGTH
          ? `Write at least ${SHORT_NOTE_MIN_LENGTH} characters: what was wrong with this penalty.`
          : undefined,
    };
    setErrors(next);
    if (next.reason || next.note) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await suspendCase(proposalId, {
        reasonCode: reason,
        note: note.trim(),
        ticketRef: ticket.trim() || undefined,
      });
      const picked = reason;
      setReason("");
      setNote("");
      setTicket("");
      onOpenChange(false);
      onDone(answer, picked);
    } catch (error) {
      setFailure({ sentence: operatorErrorSentence(error), code: error instanceof ApiError ? error.code : null });
    } finally {
      setBusy(false);
    }
  };

  const approvers = directory.isPending ? undefined : eligibleApprovers("S-1", directory.operators, me.id);

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Suspend this {penaltyText} penalty?</SheetTitle>
          <SheetDescription className="sr-only">Suspending cancels the penalty; nothing is taken from the provider.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          <WhatHappens
            lines={[
              { icon: <ShieldCheck />, text: `Nothing is taken: the ${penaltyText} stays with the provider.` },
              { icon: <PenLine />, text: "If it already stands on chain, the arbiter key signs its cancel next." },
              twoPerson
                ? { icon: <Users />, text: `Needs a second approver${approvers && approvers.length > 0 ? `: ${approvers.slice(0, 2).join(" or ")}` : ""}.` }
                : { icon: <History />, text: "Recorded in Activity under your name." },
              { icon: <Undo2 />, text: "It can't be undone." },
            ]}
          />
          {waiting ? (
            <p role="status" className="w-full rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-02">
              A suspension of this penalty is already waiting for approval, so a second one is not sent.{" "}
              <Link href={approvalHref(waiting.id)} className="text-primary-600 hover:underline">
                Open the waiting request
              </Link>
            </p>
          ) : null}
          <ReasonChips
            label="Why"
            options={SUSPEND_REASONS}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={SHORT_NOTE_MIN_LENGTH}
            noteMax={4096}
            notePlaceholder="What was wrong with this penalty, and how you know."
            errors={errors}
          />
          <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="OPS-1187" maxLength={128} className="font-sans text-body-sm" />
          {twoPerson ? <ApprovalFooter needs={approvalNeeds("S-1")} approvers={approvers} /> : null}
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <div role="alert" className={failure ? "text-body-xs text-danger-600" : "sr-only"}>
            {failure?.sentence ?? ""}
            {failure?.code ? (
              <details className="mt-1 text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="font-mono text-mono-xs">{failure.code}</span>
              </details>
            ) : null}
          </div>
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={busy}>
                Keep the penalty
              </Button>
            </SheetClose>
            <Button variant="danger" loading={busy} disabled={waiting !== null} onClick={() => void submit()}>
              {twoPerson ? "Send for approval" : "Suspend penalty"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
