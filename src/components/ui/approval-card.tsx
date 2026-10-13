"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Approval Card.
 *
 * This is the "ask" region from the Foundations rule "stop, tell and ask are
 * three different regions": a limit refuses a call outright and an alert
 * blocks nothing, but an approval HOLDS a call open for a human to decide.
 * The card therefore always renders two distinct outcomes — approve
 * (in either of its two forms) and decline — never a single acknowledgement
 * control.
 *
 * On the approval-link screen the card fills the screen's body rather than
 * the design sample's fixed 380px, so this build fills its container.
 */

export interface ApprovalCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Card heading. */
  title?: string;
  /** Full expiry sentence, e.g. "Expires in 27 minutes". */
  expiryLabel?: string;
  /** The amount being requested, formatted, e.g. "$2.50". */
  amount: string;
  /** The tool/binding this call is against, e.g. "deep_research". */
  toolName: string;
  /** Context line, e.g. "agent prod · prv_findr · verified tier". */
  context: string;
  /** The raw request payload, pretty-printed. */
  requestPayload: string;
  /** "Spent today" fact value, e.g. "$8.20 of $10.00". */
  spentToday: string;
  /** "This session" fact value, e.g. "$0.86". */
  sessionSpend: string;
  /** "Balance after" fact value, e.g. "$9.90". */
  balanceAfter: string;
  /** Tool name used in the scoped-approve button label. Defaults to `toolName`. */
  scopedToolName?: string;
  /** Limit named in the scoped-approve button label, e.g. "$10". */
  scopedLimit: string;
  onApprove?: () => void;
  onApproveScoped?: () => void;
  onDecline?: () => void;
  /** Disables all three actions, e.g. while a decision is submitting. */
  disabled?: boolean;
}

export const ApprovalCard = React.forwardRef<HTMLDivElement, ApprovalCardProps>(
  (
    {
      className,
      title = "Approve a payment",
      expiryLabel = "Expires in 27 minutes",
      amount,
      toolName,
      context,
      requestPayload,
      spentToday,
      sessionSpend,
      balanceAfter,
      scopedToolName,
      scopedLimit,
      onApprove,
      onApproveScoped,
      onDecline,
      disabled = false,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-xl border border-02 bg-01 shadow-lifted",
          className
        )}
        {...props}
      >
        <div className="flex flex-col gap-1 border-b border-01 px-5 py-4">
          <h2 className="text-label-md text-01">{title}</h2>
          <p className="font-mono text-mono-13 text-warning-600">{expiryLabel}</p>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-mono text-mono-md font-semibold text-01">
              {amount}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-01">
              {toolName}
            </span>
          </div>

          <p className="font-mono text-mono-13 text-03">{context}</p>

          <div className="flex flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3.5">
            <span className="font-mono text-mono-2xs text-03">
              REQUEST
            </span>
            <pre className="whitespace-pre-wrap break-words font-mono text-mono-13 text-01">
              {requestPayload}
            </pre>
          </div>

          <dl className="flex flex-col">
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-body-13 text-02">Spent today</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {spentToday}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-body-13 text-02">This session</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {sessionSpend}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-body-13 text-02">Balance after</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {balanceAfter}
              </dd>
            </div>
          </dl>

          <p className="text-body-13 text-02">
            If you decline, this call is refused. The agent decides what to do next; nothing
            else is stopped.
          </p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={disabled}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-md bg-success-500 px-3.5 text-label-sm text-on-color shadow-hair",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
            >
              <Check className="h-4 w-4" />
              Approve this call
            </button>

            <button
              type="button"
              onClick={onApproveScoped}
              disabled={disabled}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-md border border-02 bg-01 px-3.5 text-label-sm text-01",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
            >
              Approve {scopedToolName ?? toolName} to {scopedLimit} today
            </button>

            <button
              type="button"
              onClick={onDecline}
              disabled={disabled}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-label-sm text-02",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }
);
ApprovalCard.displayName = "ApprovalCard";
