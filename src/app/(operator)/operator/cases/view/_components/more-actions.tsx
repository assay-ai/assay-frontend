"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { CopyChip } from "@/components/patterns/copy-chip";
import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { approvalHref, sentForApproval, type TwoPersonAnswer } from "@/features/operator/two-person";
import { approvalNeeds, reasonText } from "@/features/operator/approvals";
import type { CaseAuthority } from "@/features/operator/case-flow";
import { eligibleApprovers } from "@/features/operator/inbox";
import { operatorErrorSentence } from "@/features/operator/operator-errors";
import { DECISION_NOTE_MIN_LENGTH, REASON_CODES, SHORT_NOTE_MIN_LENGTH } from "@/features/operator/reason-codes";
import { ResultCard } from "@/features/operator/result-card";
import { chainIdOf, runOperatorIntent, signerIsHolder } from "@/features/operator/run-operator-intent";
import { isSweepable, may } from "@/features/operator/state";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { ArbitrationOutcome, CompensationIntent, OperatorCaseBrief, OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { createCompensationIntent, openFleetSweep, recordCompensation } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * The rare actions on a penalty, collapsed under "More actions": block the
 * provider, open a fleet sweep (two-person), compensate an executed penalty
 * (two-person), and its history in Activity. Only what this operator may do
 * is listed; the rest is not drawn.
 */

const COMPENSATE_REASONS: readonly ReasonOption[] = [
  { value: "EXECUTED_IN_ERROR", label: "Executed in error", hint: "The penalty should never have executed." },
  { value: "PLATFORM_DEFECT", label: "Our defect", hint: "Our mapping, checks or routing caused it." },
  { value: "OTHER", label: "Other", hint: "Say why in the note." },
];

type Open = "sweep" | "compensate" | null;

export function MoreActions({
  brief,
  proposalId,
  identity,
  authority,
  onSuspend,
  suspendBlocked = null,
}: {
  brief: OperatorCaseBrief;
  proposalId: string;
  identity: OperatorIdentity;
  authority: CaseAuthority;
  /** Shown here when Suspend is not already on the next-step card. */
  onSuspend: (() => void) | null;
  /** "Why you can't, and who can", when the penalty can be suspended but not by this operator. */
  suspendBlocked?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<Open>(null);
  const outcome = brief.case.proposal.outcome;
  const canSweep = may(identity.roles, "sweep") && isSweepable(outcome);
  const providerId = brief.case.proposal.providerId;

  const items: React.ReactNode[] = [];
  if (onSuspend) {
    items.push(
      <Row key="suspend" title="Suspend this penalty" description="Cancels it before it executes. Use it for a penalty proposed in error.">
        <Button variant="secondary" size="sm" onClick={onSuspend}>
          Suspend
        </Button>
      </Row>,
    );
  }
  if (suspendBlocked) {
    items.push(
      <div key="suspend-blocked" className="border-t border-01 py-3 first:border-t-0">
        {suspendBlocked}
      </div>,
    );
  }
  if (authority.block) {
    items.push(
      <Row key="block" title="Block this provider" description="Stops the provider's organization from using Assay, at once.">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/operator/blocks?block=${encodeURIComponent(providerId)}&kind=ORGANIZATION`}>Block provider</Link>
        </Button>
      </Row>,
    );
  }
  if (canSweep) {
    items.push(
      <Expandable
        key="sweep"
        title="Open a fleet sweep"
        description="Decides every case the same defect touched the way this one was decided. Needs a second adjudicator."
        open={open === "sweep"}
        onToggle={() => setOpen(open === "sweep" ? null : "sweep")}
      >
        <SweepForm proposalId={proposalId} outcome={outcome as ArbitrationOutcome} me={identity} />
      </Expandable>,
    );
  }
  if (authority.compensate) {
    items.push(
      <Expandable
        key="compensate"
        title="Compensate the provider"
        description="Pays an executed penalty back into the provider's stake, from the treasury. Needs a second approver."
        open={open === "compensate"}
        onToggle={() => setOpen(open === "compensate" ? null : "compensate")}
      >
        <CompensateForm brief={brief} proposalId={proposalId} me={identity} />
      </Expandable>,
    );
  }

  return (
    <details className="group w-full rounded-xl border border-01 bg-01">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 tablet:px-5">
        <span className="text-label-md text-01">More actions</span>
        <ChevronDown aria-hidden="true" className="size-4 text-03 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex w-full flex-col border-t border-01 px-4 tablet:px-5">
        {items.length === 0 ? (
          <p className="py-3 text-body-13 text-02">Nothing else on this penalty is open to your roles.</p>
        ) : (
          items
        )}
        <p className="border-t border-01 py-3 text-body-13 text-02">
          <Link href={`/operator/override-log?targetId=${encodeURIComponent(proposalId)}`} className="text-primary-600 hover:underline">
            History of this penalty in Activity
          </Link>
        </p>
      </div>
    </details>
  );
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-2 border-t border-01 py-3 first:border-t-0 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-label-13 text-01">{title}</p>
        <p className="text-body-xs text-03">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Expandable({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col border-t border-01 first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start justify-between gap-3 py-3 text-left">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label-13 text-01">{title}</span>
          <span className="text-body-xs text-03">{description}</span>
        </span>
        <ChevronDown aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-03 transition-transform", open && "rotate-180")} />
      </button>
      {/* Kept mounted while collapsed: a prepared deposit, a signature or a sent request must survive a toggle. */}
      <div hidden={!open} className={open ? "flex w-full flex-col gap-3 pb-4" : undefined}>
        {children}
      </div>
    </div>
  );
}

function Failure({ error }: { error: unknown }) {
  if (!error) return <p className="sr-only" role="alert" />;
  return (
    <div role="alert" className="text-body-xs text-danger-600">
      {operatorErrorSentence(error)}
      {error instanceof ApiError ? (
        <details className="mt-1 text-03">
          <summary className="cursor-pointer select-none text-label-xs">Details</summary>
          <span className="font-mono text-mono-xs">{error.code}</span>
        </details>
      ) : null}
    </div>
  );
}

function Queued({ answer, what, needs, approvers }: { answer: TwoPersonAnswer<unknown>; what: string; needs: string; approvers: string[] | undefined }) {
  if (answer.kind !== "queued") return <ResultCard title={`${what}: done`} />;
  const sent = sentForApproval(what, approvers, needs, answer.approval.expiresAt);
  return (
    <ResultCard tone="queued" title={sent.title} next={sent.next} link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }} />
  );
}

// ── Fleet sweep (S-11) ──────────────────────────────────────────────────────

function SweepForm({ proposalId, outcome, me }: { proposalId: string; outcome: ArbitrationOutcome; me: OperatorIdentity }) {
  const queryClient = useQueryClient();
  const directory = useOperatorDirectory();
  const [defectKey, setDefectKey] = React.useState("");
  const [hours, setHours] = React.useState("720");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ defect?: string; hours?: string; reason?: string; note?: string }>({});
  const options = (REASON_CODES[outcome] ?? []).map((code) => ({ value: code, label: reasonText(code) }));
  const sweep = useMutation({
    mutationFn: () =>
      openFleetSweep(proposalId, { defectKey: defectKey.trim(), lookbackHours: Number(hours), reasonCode: reason, note: note.trim() }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["operator"] }),
  });

  const submit = () => {
    const lookback = Number(hours);
    const next = {
      defect: defectKey.trim() ? undefined : "Name the defect, e.g. the mapping regression's key.",
      hours: Number.isInteger(lookback) && lookback >= 1 && lookback <= 2160 ? undefined : "Whole hours, 1 to 2160 (90 days).",
      reason: reason ? undefined : "Pick a reason.",
      note: note.trim().length < DECISION_NOTE_MIN_LENGTH ? `Write at least ${DECISION_NOTE_MIN_LENGTH} characters: providers who never disputed are decided on this.` : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    sweep.mutate();
  };

  const approvers = directory.isPending ? undefined : eligibleApprovers("S-11", directory.operators, me.id);
  if (sweep.data) return <Queued answer={sweep.data} what="The fleet sweep" needs={approvalNeeds("S-11")} approvers={approvers} />;
  return (
    <>
      <Field label="Defect" value={defectKey} onChange={(e) => setDefectKey(e.target.value)} placeholder="MAPPING_REGRESSION_2026_10" maxLength={128} error={errors.defect} />
      <Field label="Look back" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" suffix="h" maxLength={4} error={errors.hours} hint="Every case with this defect in that many hours is matched." />
      <ReasonChips
        label="Why"
        options={options}
        value={reason}
        onChange={setReason}
        note={note}
        onNoteChange={setNote}
        noteMin={DECISION_NOTE_MIN_LENGTH}
        notePlaceholder="What the defect is, how it was found, and why every matched case shares it."
        errors={errors}
      />
      <ApprovalFooter needs={approvalNeeds("S-11")} approvers={directory.isPending ? undefined : eligibleApprovers("S-11", directory.operators, me.id)} />
      <Failure error={sweep.error} />
      <Button variant="danger" className="self-start" loading={sweep.isPending} onClick={submit}>
        Send the sweep for approval
      </Button>
    </>
  );
}

// ── Compensation (build, then S-5 record) ───────────────────────────────────

function CompensateForm({ brief, proposalId, me }: { brief: OperatorCaseBrief; proposalId: string; me: OperatorIdentity }) {
  const queryClient = useQueryClient();
  const directory = useOperatorDirectory();
  const [intent, setIntent] = React.useState<CompensationIntent | null>(null);
  const [signature, setSignature] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ signature?: string; reason?: string; note?: string }>({});
  const [signing, setSigning] = React.useState(false);
  const [signError, setSignError] = React.useState<string | null>(null);

  const signerState = useSigner({ chainId: intent ? chainIdOf(intent.depositor) : null });
  const wallet = signerState.status === "ready" ? signerState.signer.address : null;
  const holdsTreasury = wallet !== null && intent !== null && signerIsHolder(wallet, intent.depositor);

  const build = useMutation({ mutationFn: () => createCompensationIntent(proposalId), onSuccess: setIntent });
  const record = useMutation({
    mutationFn: () => recordCompensation(proposalId, { signature: signature.trim(), reasonCode: reason, note: note.trim() }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["operator"] }),
  });

  const penalty = brief.case.proposal.appliedAmount ?? brief.case.proposal.penaltyAmount;

  if (record.data) {
    return (
      <Queued
        answer={record.data}
        what="Recording the compensation"
        needs={approvalNeeds("S-5")}
        approvers={directory.isPending ? undefined : eligibleApprovers("S-5", directory.operators, me.id)}
      />
    );
  }
  if (!intent) {
    return (
      <>
        <p className="text-body-13 text-02">
          First the deposit is prepared: {formatMoney(penalty)} from the treasury into the provider&rsquo;s stake. Preparing it moves
          nothing; the treasury&rsquo;s signers pay it.
        </p>
        <Failure error={build.error} />
        <Button className="self-start" loading={build.isPending} onClick={() => build.mutate()}>
          Prepare the deposit
        </Button>
      </>
    );
  }

  const signHere = async () => {
    if (signerState.status !== "ready") return;
    setSigning(true);
    setSignError(null);
    try {
      const { signature: signed } = await runOperatorIntent(intent.transaction, intent.depositor, signerState.signer);
      setSignature(signed);
    } catch (e) {
      setSignError(isUserRejection(e) ? "Nothing was signed: the wallet prompt was closed." : e instanceof Error ? e.message : "The wallet did not complete this.");
    } finally {
      setSigning(false);
    }
  };

  const submit = () => {
    const next = {
      signature: signature.trim() ? undefined : "Paste the signature of the confirmed deposit.",
      reason: reason ? undefined : "Pick a reason.",
      note: note.trim().length < SHORT_NOTE_MIN_LENGTH ? `Write at least ${SHORT_NOTE_MIN_LENGTH} characters.` : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    record.mutate();
  };

  return (
    <>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-13 text-02">
        <li>
          The treasury signs the deposit of {formatMoney(penalty)}.{" "}
          {holdsTreasury ? (
            <Button variant="secondary" size="sm" loading={signing} onClick={() => void signHere()}>
              Sign here
            </Button>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              Copy it to where the treasury keys are:
              <CopyChip value={intent.transaction} display="Copy deposit" label="deposit transaction" />
            </span>
          )}
        </li>
        <li>Paste the confirmed signature below. Assay checks the deposit on chain before it records anything.</li>
      </ol>
      {signError ? <p className="text-body-xs text-danger-600">{signError}</p> : null}
      <Field label="Signature of the confirmed deposit" value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={128} error={errors.signature} />
      <ReasonChips
        label="Why"
        options={COMPENSATE_REASONS}
        value={reason}
        onChange={setReason}
        note={note}
        onNoteChange={setNote}
        noteMin={SHORT_NOTE_MIN_LENGTH}
        notePlaceholder="Why the executed penalty is paid back, and what shows it."
        errors={errors}
      />
      <ApprovalFooter needs={approvalNeeds("S-5")} approvers={directory.isPending ? undefined : eligibleApprovers("S-5", directory.operators, me.id)} />
      <Failure error={record.error} />
      <Button className="self-start" loading={record.isPending} onClick={submit}>
        Send the record for approval
      </Button>
      <details className="rounded-md border border-01 bg-02 px-3 py-2">
        <summary className="cursor-pointer select-none text-label-13 text-02">Technical details</summary>
        <dl className="mt-2 flex flex-col gap-1.5 text-body-xs">
          <dt className="text-03">Signed and paid by</dt>
          <dd className="break-all font-mono text-mono-xs text-01">{intent.depositor}</dd>
          <dt className="text-03">Provider stake account</dt>
          <dd className="break-all font-mono text-mono-xs text-01">{intent.provider}</dd>
        </dl>
      </details>
    </>
  );
}
