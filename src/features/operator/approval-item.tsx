"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, Check, ChevronDown, History, KeyRound, Link2, MoreHorizontal, PenLine, Undo2, Zap } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { approverNames } from "@/components/patterns/approval-footer";
import { ChangeInline } from "@/components/patterns/change-rows";
import { ConfirmSheet, type ConfirmOutcome } from "@/components/patterns/confirm-sheet";
import { UtcTime } from "@/components/patterns/utc-time";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { approveApproval, rejectApproval } from "@/services/operator.service";
import { cn } from "@/utils";

import {
  approvalActivityHref,
  approvalChanges,
  approvalErrorMessage,
  approvalNeeds,
  approvalOutcome,
  approvedResultSentence,
  decisionText,
  describeApproval,
  isWithdrawn,
  type ApprovalContext,
  type ApprovalOutcomeLine,
} from "./approvals";
import { ContractCallAction } from "./contract-call-action";
import { Deadline } from "./deadline";
import { ResultCard } from "./result-card";
import { approvalHref } from "./two-person";

/**
 * One two-person request as a row of a list, the same on Home and on the
 * Approvals screen. The parent draws the bordered container and the dividers.
 *
 *   line 1  Pay back Meridian Index's $3.75 penalty     Riley Brooks · 02:08  [clock] 17h left  [Reject] [Approve]
 *   line 2  Executed → Paid back to the provider · Executed in error
 *
 * One filled button per row: Approve (decide), Copy link (your own request,
 * Withdraw in the ⋯ menu), none for a request waiting on a role you lack.
 * Approve and Reject go through a confirm that says what happens; the result
 * replaces the buttons with where to see it. A non-compact row (Approvals)
 * opens the request's fields from its chevron.
 */
export type ApprovalItemMode = "decide" | "own" | "other" | "history";

export interface ApprovalItemProps {
  approval: OperatorApproval;
  context: ApprovalContext;
  mode: ApprovalItemMode;
  /** Names of who could approve. */
  approvers?: readonly string[];
  /** Turns a subject (`sam@`) into a name. */
  nameOf: (subject: string | null | undefined) => string;
  highlighted?: boolean;
  /** No details expander (Home). */
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
  /** An approved on-chain block (A-11): its unsigned call, which the arbiter's wallet still signs. */
  chainBlock?: ApprovedChainBlock | null;
}

/** The approved arbiter block's unsigned call and the address the approver approved. */
export interface ApprovedChainBlock {
  call: SlashContractCall;
  account: string;
}

type Outcome = { kind: "approved" | "rejected" | "withdrawn"; text: string; next?: string; chainBlock?: ApprovedChainBlock | null };

/** The unsigned `setBlocked` an approved `arbiter.block` answers with, or null for any other result. */
export function approvedChainBlockOf(approval: Pick<OperatorApproval, "action" | "payload">, result: unknown): ApprovedChainBlock | null {
  if (approval.action !== "arbiter.block") return null;
  const account = approval.payload.account;
  const call = result as Partial<SlashContractCall> | undefined;
  if (typeof account !== "string" || !call || typeof call.to !== "string" || typeof call.data !== "string") return null;
  return { call: call as SlashContractCall, account };
}

/**
 * Signs the approved block (A-11) where the approval ran: the calldata must be
 * `setBlocked(<the approved address>, true)` on the pinned config contract.
 */
export function ApprovedChainBlockAction({ block }: { block: ApprovedChainBlock }) {
  return (
    <ContractCallAction
      call={block.call}
      expected={{ contract: "config", functionName: "setBlocked", args: [block.account, true] }}
      signLabel="Sign and send the on-chain block"
      successTitle="Blocked on chain"
      successDescription="The contracts refuse the wallet once this lands. Only the contracts' admin key can lift it on chain."
      afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. It is also listed on Arbiter until it lands."
    />
  );
}

const NEXT: Readonly<Record<string, string>> = {
  "account.unblock": "The account can use Assay again within seconds.",
  "operator.add": "They can sign in with their wallet now.",
  "operator.change": "Their new access applies from their next request.",
  "slash.suspend": "If the record stands on chain, its cancel still needs the arbiter's signature: see the penalty.",
  "slash.sweep": "Matching cases are decided in the background.",
  // No "arbiter.block": its result sentence already says nothing is blocked on
  // chain until the arbiter signs, and where; a second line said it again.
};

const OUTCOME_ICON: Readonly<Record<ApprovalOutcomeLine["kind"], ConfirmOutcome["icon"]>> = {
  money: Banknote,
  access: KeyRound,
  chain: PenLine,
  runs: Zap,
  record: History,
};

function historyChip(approval: OperatorApproval): StatusChipKey {
  if (approval.status === "APPROVED") return "done";
  if (isWithdrawn(approval)) return "withdrawn";
  return approval.status === "EXPIRED" ? "expired" : "rejected";
}

function lowerFirst(value: string): string {
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function absolute(link: string): string {
  if (/^https?:\/\//.test(link) || typeof window === "undefined") return link;
  return `${window.location.origin}${link.startsWith("/") ? "" : "/"}${link}`;
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute(link));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: the link is in the title for a manual copy.
    }
  };
  return (
    // Secondary: lime means "your action now", and a request that waits on someone else is not.
    <Button
      type="button"
      size="sm"
      variant="secondary"
      data-primary=""
      className="touch-target"
      title={absolute(link)}
      icon={copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      onClick={() => void copy()}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

export function ApprovalItem({ approval, context, mode, approvers, nameOf, highlighted, compact, onDecided, className }: ApprovalItemProps) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = React.useState<"approve" | "reject" | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [open, setOpen] = React.useState(false);
  const detailsId = React.useId();

  const { title, reason, target, fields } = describeApproval(approval, context);
  const changes = approvalChanges(approval, context);
  // A decided request: today's "before" says nothing about it, so no diff in its row.
  const rowChanges = mode === "history" ? [] : changes;
  const pending = approval.status === "PENDING";
  const names = approverNames(approvers);
  const requesterRoles = approval.requestedById ? context.operators.get(approval.requestedById)?.roles : undefined;
  const needs = `Needs ${approvalNeeds(approval.code, requesterRoles)}${names ? `: ${names}` : ""}`;

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
        chainBlock: next.chainBlock ?? null,
      });
    } else {
      setOutcome(next);
    }
    refresh();
  };
  const onApprove = async () => {
    const decision = await approveApproval(approval.id);
    settle({
      kind: "approved",
      text: approvedResultSentence(approval.action, decision.result, target.label),
      next: NEXT[approval.action],
      chainBlock: approvedChainBlockOf(approval, decision.result),
    });
  };
  const onReject = async () => {
    await rejectApproval(approval.id);
    settle(mode === "own" ? { kind: "withdrawn", text: "Request withdrawn. Nothing ran." } : { kind: "rejected", text: "Request rejected. Nothing ran." });
  };
  const describe = (kind: "approve" | "reject") => (error: unknown) => {
    if (error instanceof ApiError && error.code === "OPERATOR_APPROVAL_NOT_PENDING") refresh();
    return approvalErrorMessage(error, kind);
  };

  const waitingFor = names ? `waiting for ${names}` : "waiting for an approver";
  const meta =
    mode === "history" ? (
      <>
        {decisionText(approval, nameOf)}{" "}
        · <UtcTime value={approval.decidedAt ?? approval.expiresAt} /> ·{" "}
        <Link href={approvalActivityHref(approval)} className="hit-area text-primary-700 hover:underline">
          {/* Not "History": that is the tab this row sits under. */}
          See in Activity
        </Link>
      </>
    ) : mode === "own" ? (
      <>{waitingFor}</>
    ) : (
      <>
        {nameOf(approval.requestedBy)} · asked <UtcTime value={approval.createdAt} midSentence />
        {/* Who must approve, visible without a hover (operator review 2026-10-16b, P1-8). */}
        {mode === "other" ? ` · ${waitingFor}` : pending ? ` · ${needs.charAt(0).toLowerCase()}${needs.slice(1)}` : null}
      </>
    );

  const showActions = pending && !outcome && (mode === "decide" || mode === "own");
  const expandable = !compact && fields.length > 0;

  return (
    <article
      id={`approval-${approval.id}`}
      data-inbox-row=""
      tabIndex={-1}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 px-4 py-3 outline-none focus-visible:bg-02 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
        highlighted && "bg-primary-10",
        className,
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-2 tablet:flex-row tablet:items-center tablet:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {mode === "history" ? <StatusChip status={historyChip(approval)} /> : null}
            {target.href ? (
              <Link href={target.href} className="hit-area min-w-0 text-label-sm text-01 [overflow-wrap:anywhere] hover:underline">
                {title}
              </Link>
            ) : (
              <span className="min-w-0 text-label-sm text-01 [overflow-wrap:anywhere]">{title}</span>
            )}
          </p>
          {rowChanges.length > 0 || reason ? (
            <p className="text-body-13 [overflow-wrap:anywhere]">
              <ChangeInline changes={rowChanges} />
              {reason ? (
                <span className="text-03">
                  {rowChanges.length > 0 ? " · " : ""}
                  {reason}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 shrink-0 flex-col gap-2 tablet:flex-row tablet:items-center tablet:gap-4">
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-body-xs text-03">
            <span className="min-w-0">{meta}</span>
            {pending ? <Deadline kind="approval" until={approval.expiresAt} from={approval.createdAt} /> : null}
          </p>
          {/* Phone: two equal buttons across the row. From 640px they keep
              their own width, at the right, instead of stretching. */}
          {showActions ? (
            <div className="grid w-full grid-cols-[1fr_1fr] gap-2 sm:flex sm:w-auto sm:self-end tablet:self-auto">
              {mode === "decide" ? (
                <>
                  <Button type="button" size="sm" variant="secondary" className="touch-target" onClick={() => setConfirm("reject")}>
                    Reject
                  </Button>
                  <Button type="button" size="sm" data-primary="" className="touch-target" title={needs} onClick={() => setConfirm("approve")}>
                    Approve
                  </Button>
                </>
              ) : (
                <>
                  <CopyLinkButton link={approvalHref(approval.id)} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="touch-target"
                        aria-label="More for this request"
                        icon={<MoreHorizontal aria-hidden="true" />}
                      >
                        <span className="tablet:sr-only">More</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setConfirm("reject")} className="touch-target gap-2">
                        <Undo2 aria-hidden="true" className="size-4" />
                        Withdraw request
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          ) : null}
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((value) => !value)}
              className="touch-target inline-flex items-center gap-1 self-start rounded-md text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:self-center"
            >
              <span className="tablet:sr-only">Details</span>
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
            </button>
          ) : null}
        </div>
      </div>

      {expandable && open ? (
        <dl id={detailsId} className="mt-2 grid w-full grid-cols-1 gap-x-6 gap-y-1.5 border-t border-01 pt-2.5 text-body-13 tablet:grid-cols-[160px_minmax(0,1fr)]">
          {pending ? (
            <>
              <dt className="text-label-13 text-02">Who can approve</dt>
              <dd className="text-01">{needs.replace(/^Needs a/, "A")}</dd>
            </>
          ) : null}
          {fields.map((line) => (
            <React.Fragment key={line.label}>
              <dt className="text-label-13 text-02">{line.label}</dt>
              <dd className="text-01 [overflow-wrap:anywhere]">{line.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}

      {outcome ? (
        <ResultCard
          className="mt-2"
          tone="done"
          title={outcome.text}
          next={outcome.next}
          activityHref={outcome.kind === "approved" ? approvalActivityHref(approval) : null}
        />
      ) : null}
      {outcome?.chainBlock ? (
        <div className="mt-2">
          <ApprovedChainBlockAction block={outcome.chainBlock} />
        </div>
      ) : null}

      <ConfirmSheet
        open={confirm === "approve"}
        onOpenChange={(next) => setConfirm(next ? "approve" : null)}
        tone="primary"
        title={`Approve: ${lowerFirst(title)}?`}
        outcome={approvalOutcome(approval, context).map((line) => ({ icon: OUTCOME_ICON[line.kind], text: line.text }))}
        changes={changes}
        confirmLabel="Approve and run"
        onConfirm={onApprove}
        describeError={describe("approve")}
      />
      <ConfirmSheet
        open={confirm === "reject"}
        onOpenChange={(next) => setConfirm(next ? "reject" : null)}
        tone="danger"
        title={mode === "own" ? "Withdraw your request?" : `Reject: ${lowerFirst(title)}?`}
        outcome={
          mode === "own"
            ? [
                { icon: Ban, text: "Nothing runs, and nobody can approve it any more" },
                { icon: Undo2, text: "You can ask again later" },
              ]
            : [
                { icon: Ban, text: "Nothing runs" },
                { icon: History, text: `${nameOf(approval.requestedBy)} sees it as rejected, under your name` },
              ]
        }
        confirmLabel={mode === "own" ? "Withdraw request" : "Reject request"}
        onConfirm={onReject}
        describeError={describe("reject")}
      />
    </article>
  );
}

/**
 * A section of rows: a small header with a count and an optional link at
 * the right, then one bordered container with dividers. Home and Approvals.
 */
export function RowSection({
  id,
  title,
  count,
  hint,
  action,
  children,
}: {
  id: string;
  title: string;
  /** The number of rows, or a short phrase. */
  count?: number | string;
  /** Shown on hover of the header (the rule behind the order). */
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} title={hint} className="text-label-13 text-02">
          {title}
          {count !== undefined ? <span className="tabular-nums text-03"> · {count}</span> : null}
        </h2>
        {action}
      </div>
      <div className="flex w-full min-w-0 flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
        {children}
      </div>
    </section>
  );
}
