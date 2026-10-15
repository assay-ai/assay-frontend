"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { ChangeRows } from "@/components/patterns/change-rows";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { LocalTime } from "@/components/patterns/local-time";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { approveApproval, rejectApproval } from "@/services/operator.service";
import { cn } from "@/utils";

import {
  actionLabel,
  approvalActivityHref,
  approvalChanges,
  approvalErrorMessage,
  approvalNeeds,
  approvedResultSentence,
  decisionText,
  describeApproval,
  isWithdrawn,
  type ApprovalContext,
} from "./approvals";
import { ResultCard } from "./result-card";
import { approvalHref } from "./two-person";

/**
 * One two-person request, the same on Home and on the Approvals screen:
 * the sentence, before → after, who must approve it (with a link to send
 * them) and how long it stays open. Approve and Reject go through a confirm
 * step; the result replaces the buttons with where to see it.
 */
export type ApprovalItemMode = "decide" | "own" | "other" | "history";

export interface ApprovalItemProps {
  approval: OperatorApproval;
  context: ApprovalContext;
  mode: ApprovalItemMode;
  /** Names of who could approve (for the footer). */
  approvers?: readonly string[];
  /** Turns a subject (`sam@`) into a name. */
  nameOf: (subject: string | null | undefined) => string;
  highlighted?: boolean;
  /** Smaller: no field list (Home). */
  compact?: boolean;
  /**
   * Receives the outcome. A decided request leaves the waiting list on the
   * next refresh, so the page shows the result card where it stays visible.
   * Without it the card shows in place.
   */
  onDecided?: (result: ApprovalResult) => void;
  className?: string;
}

export interface ApprovalResult {
  id: string;
  title: string;
  next?: string;
  activityHref?: string | null;
}

type Outcome = { kind: "approved" | "rejected" | "withdrawn"; text: string; next?: string };

const NEXT: Readonly<Record<string, string>> = {
  "account.unblock": "The account can use Assay again within seconds.",
  "operator.add": "They can sign in with their wallet now.",
  "operator.change": "Their new access applies from their next request.",
  "slash.suspend": "If the record stands on chain, its cancel still needs the arbiter's signature: see the penalty.",
  "slash.compensated": "The case is closed as compensated.",
  "slash.sweep": "Matching cases are decided in the background.",
};

export function ApprovalItem({ approval, context, mode, approvers, nameOf, highlighted, compact, onDecided, className }: ApprovalItemProps) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = React.useState<"approve" | "reject" | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const { sentence, target, fields } = describeApproval(approval, context);
  const changes = approvalChanges(approval, context);
  const pending = approval.status === "PENDING";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["operator"] });
  };

  const settle = (next: Outcome) => {
    if (onDecided) {
      onDecided({
        id: approval.id,
        title: next.text,
        next: next.next,
        activityHref: next.kind === "approved" ? approvalActivityHref(approval) : null,
      });
    } else {
      setOutcome(next);
    }
    refresh();
  };
  const onApprove = async () => {
    const decision = await approveApproval(approval.id);
    settle({ kind: "approved", text: approvedResultSentence(approval.action, decision.result, target.label), next: NEXT[approval.action] });
  };
  const onReject = async () => {
    await rejectApproval(approval.id);
    settle(mode === "own" ? { kind: "withdrawn", text: "Request withdrawn. Nothing ran." } : { kind: "rejected", text: "Request rejected. Nothing ran." });
  };
  const describe = (kind: "approve" | "reject") => (error: unknown) => {
    if (error instanceof ApiError && error.code === "OPERATOR_APPROVAL_NOT_PENDING") refresh();
    return approvalErrorMessage(error, kind);
  };

  return (
    <article
      id={`approval-${approval.id}`}
      data-inbox-row=""
      tabIndex={-1}
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-xl border border-01 bg-01 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        highlighted && "ring-2 ring-primary-500",
        className,
      )}
    >
      <header className="flex w-full min-w-0 flex-col gap-1">
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="text-label-xs uppercase tracking-[0.04em] text-03">{actionLabel(approval.action)}</p>
          {mode === "history" ? (
            <StatusChip
              status={approval.status === "APPROVED" ? "done" : isWithdrawn(approval) ? "closed" : approval.status === "EXPIRED" ? "closed" : "failed"}
              detail={approval.status === "APPROVED" ? undefined : isWithdrawn(approval) ? "withdrawn" : approval.status.toLowerCase()}
            />
          ) : mode === "decide" ? (
            <StatusChip status="needs-you" />
          ) : null}
        </div>
        <p className="text-body-sm text-01 [overflow-wrap:anywhere]">{sentence}</p>
        <p className="text-body-xs text-03">
          Asked by {nameOf(approval.requestedBy)}
          {mode === "own" ? " (you)" : ""} · <LocalTime value={approval.createdAt} />
          {target.href ? (
            <>
              {" · "}
              <Link href={target.href} className="text-primary-600 hover:underline">
                {target.label}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {changes.length > 0 ? <ChangeRows changes={changes} /> : null}

      {!compact && fields.length > 0 ? (
        <details className="w-full">
          <summary className="cursor-pointer select-none text-label-13 text-02 hover:text-01">Details of the request</summary>
          <dl className="mt-2 grid w-full grid-cols-1 gap-x-6 gap-y-1.5 text-body-13 tablet:grid-cols-[160px_minmax(0,1fr)]">
            {fields.map((line) => (
              <React.Fragment key={line.label}>
                <dt className="text-label-13 text-02">{line.label}</dt>
                <dd className="text-01 [overflow-wrap:anywhere]">{line.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      ) : null}

      {mode === "history" ? (
        <p className="text-body-xs text-02">
          {decisionText({
            ...approval,
            approvedBy: approval.approvedBy ? nameOf(approval.approvedBy) : null,
            rejectedBy: approval.rejectedBy ? nameOf(approval.rejectedBy) : null,
            requestedBy: approval.rejectedBy && isWithdrawn(approval) ? nameOf(approval.rejectedBy) : approval.requestedBy,
          })}{" "}
          · <LocalTime value={approval.decidedAt ?? approval.expiresAt} /> ·{" "}
          <Link href={approvalActivityHref(approval)} className="text-primary-600 hover:underline">
            History
          </Link>
        </p>
      ) : outcome ? (
        <ResultCard
          tone="done"
          title={outcome.text}
          next={outcome.next}
          activityHref={outcome.kind === "approved" ? approvalActivityHref(approval) : null}
        />
      ) : pending ? (
        <>
          <ApprovalFooter
            needs={approvalNeeds(approval.code)}
            approvers={approvers}
            link={mode === "own" ? approvalHref(approval.id) : undefined}
            createdAt={approval.createdAt}
            expiresAt={approval.expiresAt}
          />
          {mode === "decide" || mode === "own" ? (
            <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
              <Button type="button" variant="secondary" onClick={() => setConfirm("reject")}>
                {mode === "own" ? "Withdraw request" : "Reject"}
              </Button>
              {mode === "decide" ? (
                <Button type="button" data-primary="" onClick={() => setConfirm("approve")}>
                  Approve
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <ConfirmSheet
        open={confirm === "approve"}
        onOpenChange={(open) => setConfirm(open ? "approve" : null)}
        tone="primary"
        title={`Approve: ${sentence.replace(/\.$/, "")}?`}
        description="It runs at once, re-checked against how things stand now. It is recorded in Activity under your name."
        changes={changes}
        confirmLabel="Approve and run"
        onConfirm={onApprove}
        describeError={describe("approve")}
      />
      <ConfirmSheet
        open={confirm === "reject"}
        onOpenChange={(open) => setConfirm(open ? "reject" : null)}
        tone="danger"
        title={mode === "own" ? "Withdraw your request?" : "Reject this request?"}
        description={
          mode === "own"
            ? "Nothing runs, and nobody can approve it any more. You can ask again later."
            : `Nothing runs. ${nameOf(approval.requestedBy)} sees it as rejected.`
        }
        confirmLabel={mode === "own" ? "Withdraw request" : "Reject request"}
        onConfirm={onReject}
        describeError={describe("reject")}
      />
    </article>
  );
}
