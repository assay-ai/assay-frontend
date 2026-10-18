"use client";

import { Banknote, History, PenLine, Undo2, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { approvalNeeds } from "@/features/operator/approvals";
import { manualActionCopy, type ManualActionKind, type ManualActionLine } from "@/features/operator/case-flow";
import { eligibleApprovers } from "@/features/operator/inbox";
import { operatorErrorSentence } from "@/features/operator/operator-errors";
import { SHORT_NOTE_MIN_LENGTH } from "@/features/operator/reason-codes";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import { approvalHref, type TwoPersonAnswer } from "@/features/operator/two-person";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import type { ManualCaseActionResult, OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { closeNothingStanding, recordStuckExecution, reproposeCase } from "@/services/operator.service";

import { WhatHappens } from "./what-happens";

/** Why, as a chip: the chain fact the operator checked, or "Other" with the note. */
const REASONS: Record<ManualActionKind, readonly ReasonOption[]> = {
  close: [
    { value: "CHAIN_CANCELLED", label: "Cancelled on chain", hint: "The record reads cancelled; nothing stands." },
    { value: "OTHER", label: "Other", hint: "Say what happened in the note." },
  ],
  record: [
    { value: "EXECUTED_WHILE_CANCEL_WAITED", label: "Executed while the cancel waited", hint: "The record reads executed." },
    { value: "OTHER", label: "Other", hint: "Say what happened in the note." },
  ],
  repropose: [
    { value: "RECALCULATED_RECORD_CANCELLED", label: "Old record cancelled", hint: "The recalculated penalty's earlier record reads cancelled." },
    { value: "OTHER", label: "Other", hint: "Say what happened in the note." },
  ],
};

const ICON: Record<ManualActionLine["kind"], React.ReactElement> = {
  money: <Banknote />,
  chain: <PenLine />,
  approver: <Users />,
  undo: <Undo2 />,
};

/**
 * B18: one of the three explicit actions for a penalty stuck behind a
 * requested cancel — close it (nothing stands), record an execution made
 * while it waited, or propose an upheld penalty again. "What happens" first,
 * then the reason, then a confirmation the operator ticks before the button
 * enables. The backend reads the chain again before it acts and refuses if
 * the guard no longer holds; two of the three wait for a second approver.
 * Shown only when the brief's read says the action's guard holds.
 */
export function ManualActionSheet({
  kind,
  open,
  onOpenChange,
  proposalId,
  penaltyText,
  appliedText,
  me,
  waiting = null,
  onDone,
}: {
  kind: ManualActionKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  penaltyText: string;
  /** What the chain took, for the record action. */
  appliedText: string | null;
  me: Pick<OperatorIdentity, "id" | "roles">;
  /** The same request already waiting: a second one is not sent. */
  waiting?: OperatorApproval | null;
  onDone: (answer: TwoPersonAnswer<ManualCaseActionResult>) => void;
}) {
  const copy = manualActionCopy(kind, { penalty: penaltyText, applied: appliedText });
  const directory = useOperatorDirectory();
  const [reason, setReason] = React.useState(REASONS[kind][0]!.value);
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  const [busy, setBusy] = React.useState(false);
  // Set before the first await, so a second click in the same frame sends nothing.
  const sending = React.useRef(false);
  const [failure, setFailure] = React.useState<{ sentence: string; code: string | null } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setErrors({});
      setFailure(null);
      setConfirmed(false);
    }
  }, [open]);

  const submit = async () => {
    // A double click, or a request already waiting, sends nothing more.
    if (sending.current || busy || waiting || !confirmed) return;
    const next = {
      reason: reason ? undefined : "Pick a reason.",
      note:
        note.trim().length < SHORT_NOTE_MIN_LENGTH
          ? `Write at least ${SHORT_NOTE_MIN_LENGTH} characters: what you checked on chain.`
          : undefined,
    };
    setErrors(next);
    if (next.reason || next.note) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    const body = { reasonCode: reason, note: note.trim(), ticketRef: ticket.trim() || undefined };
    try {
      const answer: TwoPersonAnswer<ManualCaseActionResult> =
        kind === "close"
          ? { kind: "done", result: await closeNothingStanding(proposalId, body) }
          : kind === "record"
            ? await recordStuckExecution(proposalId, body)
            : await reproposeCase(proposalId, body);
      setNote("");
      setTicket("");
      onOpenChange(false);
      onDone(answer);
    } catch (error) {
      setFailure({ sentence: operatorErrorSentence(error), code: error instanceof ApiError ? error.code : null });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const approvers = copy.twoPerson && !directory.isPending ? eligibleApprovers(copy.code, directory.operators, me.id) : undefined;
  const lines = copy.lines.map((line) => ({
    icon: line.kind === "approver" && !copy.twoPerson ? <History /> : ICON[line.kind],
    text: line.text,
  }));

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{copy.title}</SheetTitle>
          <SheetDescription className="sr-only">{copy.lines.map((line) => line.text).join(" ")}</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          <WhatHappens lines={lines} />
          {waiting ? (
            <p role="status" className="w-full rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-02">
              The same request is already waiting for approval, so a second one is not sent.{" "}
              <Link href={approvalHref(waiting.id)} className="hit-area text-primary-600 hover:underline">
                Open the waiting request
              </Link>
            </p>
          ) : null}
          <ReasonChips
            label="Why"
            options={REASONS[kind]}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={SHORT_NOTE_MIN_LENGTH}
            noteMax={2048}
            notePlaceholder="What you checked on chain, and where."
            errors={errors}
          />
          <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="OPS-1187" maxLength={128} className="font-sans text-body-sm" />
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={busy || waiting !== null}
            label={copy.confirm}
          />
          {copy.twoPerson ? <ApprovalFooter needs={approvalNeeds(copy.code, me.roles)} approvers={approvers} /> : null}
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
                Not now
              </Button>
            </SheetClose>
            <Button
              variant={kind === "close" ? "primary" : "danger"}
              loading={busy}
              disabled={!confirmed || waiting !== null}
              onClick={() => void submit()}
            >
              {copy.submit}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
