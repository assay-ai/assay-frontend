import * as React from "react";

import { cn } from "@/utils";

/**
 * The one vocabulary for a record's state, so the buyer, provider and
 * operator screens use the same words for the same state:
 *
 *   <StatusChip status="needs-authorisation" />   → ● Needs authorisation
 *
 * Closed on purpose (like `ui/badge.tsx`): a raw API status can never be
 * passed through as the label. Map the API value to one of these keys in the
 * screen (or add a key here, with its tone, if a new state appears). Sentence
 * case with a dot; colour is never the only signal because the word is always there.
 */
export const STATUS_CHIPS = {
  // Buyer: agents, escrow and money
  paying: { label: "Paying", tone: "success" },
  ready: { label: "Ready", tone: "success" },
  "caps-not-set": { label: "Caps not set", tone: "warning" },
  "needs-authorisation": { label: "Needs authorisation", tone: "warning" },
  "no-key": { label: "No key", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  "cap-reached": { label: "Cap reached", tone: "warning" },
  revoked: { label: "Revoked", tone: "neutral" },
  "withdrawal-pending": { label: "Withdrawal pending", tone: "primary" },
  claimable: { label: "Ready to claim", tone: "success" },
  // Calls
  charged: { label: "Charged", tone: "primary" },
  "not-charged": { label: "Not charged", tone: "teal" },
  free: { label: "Free", tone: "teal" },
  checking: { label: "Checking", tone: "primary" },
  // Provider: listings and stake
  draft: { label: "Draft", tone: "neutral" },
  tested: { label: "Tested", tone: "primary" },
  live: { label: "Live", tone: "success" },
  unbonding: { label: "Unbonding", tone: "primary" },
  withdrawable: { label: "Withdrawable", tone: "success" },
  // Penalties, disputes, approvals
  "needs-action": { label: "Needs action", tone: "danger" },
  "needs-you": { label: "Needs you", tone: "danger" },
  waiting: { label: "Waiting", tone: "primary" },
  disputed: { label: "Disputed", tone: "primary" },
  upheld: { label: "Penalty upheld", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  executed: { label: "Executed", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
  blocked: { label: "Blocked", tone: "danger" },
  // Generic
  failed: { label: "Failed", tone: "danger" },
  done: { label: "Done", tone: "success" },
} as const satisfies Record<string, { label: string; tone: StatusTone }>;

export type StatusTone = "neutral" | "primary" | "success" | "warning" | "danger" | "teal";
export type StatusChipKey = keyof typeof STATUS_CHIPS;

const TONES: Record<StatusTone, { bg: string; text: string; dot: string }> = {
  neutral: { bg: "bg-03", text: "text-02", dot: "bg-text-03" },
  primary: { bg: "bg-primary-10", text: "text-primary-700", dot: "bg-primary-500" },
  success: { bg: "bg-success-10", text: "text-success-700", dot: "bg-success-500" },
  warning: { bg: "bg-warning-10", text: "text-warning-700", dot: "bg-warning-500" },
  danger: { bg: "bg-danger-10", text: "text-danger-700", dot: "bg-danger-500" },
  teal: { bg: "bg-teal-10", text: "text-teal-600", dot: "bg-teal-500" },
};

export interface StatusChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusChipKey;
  /** Extra short text after the label, e.g. a count or "since Oct 12". */
  detail?: React.ReactNode;
}

export function StatusChip({ status, detail, className, ...props }: StatusChipProps) {
  const chip = STATUS_CHIPS[status];
  const tone = TONES[chip.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-label-xs",
        tone.bg,
        tone.text,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {chip.label}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}
