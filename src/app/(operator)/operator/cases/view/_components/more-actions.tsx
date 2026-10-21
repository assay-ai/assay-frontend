"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, History, Link2, Lock, MoreHorizontal, Undo2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { CopyChip } from "@/components/patterns/copy-chip";
import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { approvalHref, sentForApproval, type TwoPersonAnswer } from "@/features/operator/two-person";
import { approvalNeeds } from "@/features/operator/approvals";
import { alreadyWaiting, shortWhyNot, type CaseAuthority } from "@/features/operator/case-flow";
import { eligibleApprovers } from "@/features/operator/inbox";
import { operatorErrorSentence } from "@/features/operator/operator-errors";
import { SHORT_NOTE_MIN_LENGTH } from "@/features/operator/reason-codes";
import { ResultCard } from "@/features/operator/result-card";
import { chainIdOf, runOperatorIntent, signerIsHolder } from "@/features/operator/run-operator-intent";
import { checkAction, rolesPhrase, whoCan, type ConsoleAction } from "@/features/operator/roles";
import { askLabel } from "@/features/operator/why-not";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { Money } from "@/interfaces/api";
import type { CompensationIntent, OperatorCaseBrief, OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { createCompensationIntent, recordCompensation } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * The rare actions on a penalty, behind the header's ⋯ menu: block the
 * provider, pay an executed penalty back (two-person), and its history in
 * Activity. An action this
 * operator may not take is still listed, disabled, with the same one-line
 * reason as the page and an "Ask …" item under it that copies the request —
 * never hidden. An action whose two-person request already waits is held
 * back the same way, so it cannot be asked for twice. The pay-back form opens
 * in a sheet.
 */

const COMPENSATE_REASONS: readonly ReasonOption[] = [
  { value: "EXECUTED_IN_ERROR", label: "Executed in error", hint: "The penalty should never have executed." },
  { value: "PLATFORM_DEFECT", label: "Our defect", hint: "Our mapping, checks or routing caused it." },
  { value: "OTHER", label: "Other", hint: "Say why in the note." },
];

type Open = "compensate" | null;

export function MoreActions({
  brief,
  proposalId,
  identity,
  authority,
  penaltyName,
  pendingActions,
}: {
  brief: OperatorCaseBrief;
  proposalId: string;
  identity: OperatorIdentity;
  authority: CaseAuthority;
  /** "Northwind Geo's $28.47 penalty", for the Ask message. */
  penaltyName: string;
  /** Approval actions already waiting on this penalty (`slash.compensated`, …). */
  pendingActions: readonly string[];
}) {
  const [open, setOpen] = React.useState<Open>(null);
  const directory = useOperatorDirectory();
  const proposal = brief.case.proposal;
  const providerId = proposal.providerId;
  const penalty = proposal.penaltyAmount;
  const executed = proposal.status === "EXECUTED";
  const names = (action: ConsoleAction, amount: Money | null) =>
    directory.isPending ? null : whoCan(action, directory.operators, { amount, exceptId: identity.id });

  // The reason alone; who to ask is its own item under it, as on the page.
  const ask = (action: ConsoleAction, amount: Money | null, message: string): Ask | null => {
    const who = names(action, amount);
    const check = checkAction(identity, action, amount);
    return who === null || check.allowed ? null : { label: askLabel(who, rolesPhrase(check.roles)), message };
  };
  const blockWhy = authority.block ? null : shortWhyNot(identity, "block", null, null);
  const blockAsk = ask("block", null, `Can you block the provider behind ${penaltyName}?`);
  const compensateWaiting = alreadyWaiting("slash.compensated", pendingActions);
  const compensateWhy =
    compensateWaiting ?? (executed && !authority.compensate ? shortWhyNot(identity, "compensate", penalty, null) : null);
  const compensateAsk = compensateWaiting ? null : ask("compensate", penalty, `Can you pay back ${penaltyName}?`);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="More actions on this penalty" className="touch-target px-2.5">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[300px] border border-01">
          {authority.block ? (
            <DropdownMenuItem asChild>
              <Link href={`/operator/blocks?block=${encodeURIComponent(providerId)}&kind=ORGANIZATION`} className="cursor-pointer">
                <Ban aria-hidden="true" />
                Block provider
              </Link>
            </DropdownMenuItem>
          ) : (
            <MenuItem icon={<Ban />} label="Block provider" why={blockWhy} ask={blockAsk} />
          )}
          {executed ? (
            <MenuItem
              icon={<Undo2 />}
              label="Pay the provider back"
              why={authority.compensate && !compensateWaiting ? null : compensateWhy}
              ask={authority.compensate ? null : compensateAsk}
              onSelect={authority.compensate && !compensateWaiting ? () => setOpen("compensate") : undefined}
            />
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/operator/activity?targetId=${encodeURIComponent(proposalId)}`} className="cursor-pointer">
              <History aria-hidden="true" />
              History in Activity
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FormSheet
        open={open === "compensate"}
        onOpenChange={(next) => setOpen(next ? "compensate" : null)}
        title={`Pay back this ${formatMoney(proposal.appliedAmount ?? penalty)} penalty?`}
        description="The treasury deposits it back into the provider's stake. Needs a second approver."
      >
        {authority.compensate ? <CompensateForm brief={brief} proposalId={proposalId} me={identity} /> : null}
      </FormSheet>
    </>
  );
}

interface Ask {
  /** "Ask Jordan or Riley". */
  label: string;
  /** What is asked, copied with a link to this page. */
  message: string;
}

function MenuItem({
  icon,
  label,
  why,
  ask = null,
  onSelect,
}: {
  icon: React.ReactElement;
  label: string;
  /** Set when refused: the item is disabled and says why. */
  why: string | null;
  /** Who to ask, under a refused item: the same Ask as the page's one-line why-not. */
  ask?: Ask | null;
  onSelect?: () => void;
}) {
  const disabled = why !== null || !onSelect;
  return (
    <>
      <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="items-start data-[disabled]:opacity-100">
        <span aria-hidden="true" className={cn("mt-0.5 [&>svg]:size-4", disabled ? "text-03" : "text-02")}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-body-13", disabled ? "text-03" : "text-01")}>{label}</span>
          {why ? (
            <span className="flex items-start gap-1 text-body-xs text-03">
              <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              {why}
            </span>
          ) : null}
        </span>
      </DropdownMenuItem>
      {disabled && why && ask ? <AskItem ask={ask} /> : null}
    </>
  );
}

/** "Ask Jordan or Riley": copies the request and this page's link, and stays open to say so. */
function AskItem({ ask }: { ask: Ask }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${ask.message} ${window.location.href}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused: the page link is still in the address bar */
    }
  };
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        void copy();
      }}
      className="-mt-1 pl-8 text-label-13 text-primary-700"
    >
      {copied ? <Check aria-hidden="true" className="size-3.5 text-success-500" /> : <Link2 aria-hidden="true" className="size-3.5" />}
      {copied ? "Message and link copied" : ask.label}
    </DropdownMenuItem>
  );
}

function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {/* Kept mounted while closed: a prepared deposit or a sent request must survive closing the sheet. */}
        <div className="flex w-full flex-col gap-3 px-[18px] pb-5 pt-4">{children}</div>
      </SheetContent>
    </Sheet>
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
        what="Recording the pay-back"
        needs={approvalNeeds("S-5", me.roles)}
        approvers={directory.isPending ? undefined : eligibleApprovers("S-5", directory.operators, me.id)}
      />
    );
  }
  if (!intent) {
    return (
      <>
        <p className="text-body-13 text-02">
          First the deposit is prepared: {formatMoney(penalty)}{" "}from the treasury into the provider&rsquo;s stake. Preparing it moves
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
      <ApprovalFooter needs={approvalNeeds("S-5", me.roles)} approvers={directory.isPending ? undefined : eligibleApprovers("S-5", directory.operators, me.id)} />
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
