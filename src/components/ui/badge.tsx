import * as React from "react";

import { cn } from "@/utils";

/**
 * Closed vocabulary of badge variants. Each key owns its own label, colour
 * and dot — a caller picks a variant, it cannot supply arbitrary text.
 *
 * This is deliberate. Foundations "Semantics that are not negotiable" rule 3
 * forbids a raw internal verdict (PASS, FAIL, SKIPPED, DEGRADED,
 * EMPTY_CONFIRMED, MISAPPLIED, …) from reaching the screen. There is no
 * `label` / `children` prop on this component for that reason — adding one
 * would make that rule impossible to enforce, because a raw verdict string
 * could be handed straight through as the visible text.
 *
 * The design draws exactly these eleven instances of the reusable Badge.
 */
const BADGE_VARIANTS = {
  active: {
    label: "ACTIVE",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  passed: {
    label: "PASSED",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  "not-charged": {
    label: "NOT CHARGED",
    dot: true,
    bg: "bg-teal-10",
    text: "text-teal-600",
    dotColor: "bg-teal-500",
  },
  degraded: {
    label: "DEGRADED",
    dot: true,
    bg: "bg-warning-10",
    text: "text-warning-700",
    dotColor: "bg-warning-500",
  },
  failed: {
    label: "FAILED",
    dot: true,
    bg: "bg-danger-10",
    text: "text-danger-700",
    dotColor: "bg-danger-500",
  },
  checking: {
    label: "CHECKING",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "not-sampled": {
    label: "NOT SAMPLED",
    dot: false,
    bg: "bg-03",
    text: "text-02",
    dotColor: "",
  },
  verified: {
    label: "verified",
    dot: false,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "",
  },
  guaranteed: {
    label: "guaranteed",
    dot: false,
    bg: "bg-indigo-10",
    text: "text-indigo-500",
    dotColor: "",
  },
  unverified: {
    label: "unverified",
    dot: false,
    bg: "bg-03",
    text: "text-02",
    dotColor: "",
  },
  free: {
    label: "FREE",
    dot: false,
    bg: "bg-teal-10",
    text: "text-teal-600",
    dotColor: "",
  },
  // ── `disputes.state` (added here, not drawn on any Badge Bench
  // instance — `DisputeState` has no variant and the rule above forbids
  // passing it through as text). The label is deliberately NOT the bare enum
  // value: `UPHELD` on a `disputes` row means the objection won and `REJECTED`
  // means it lost, which is the OPPOSITE of what those words mean on a
  // `slash_proposals` row. Spelling out "OBJECTION" on both keeps that from being
  // misread on a screen about losing money.
  "dispute-open": {
    label: "OPEN",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "dispute-under-review": {
    label: "UNDER REVIEW",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "dispute-upheld": {
    label: "OBJECTION UPHELD",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  "dispute-partially-upheld": {
    label: "PARTIALLY UPHELD",
    dot: true,
    bg: "bg-warning-10",
    text: "text-warning-700",
    dotColor: "bg-warning-500",
  },
  "dispute-rejected": {
    label: "OBJECTION REJECTED",
    dot: true,
    bg: "bg-danger-10",
    text: "text-danger-700",
    dotColor: "bg-danger-500",
  },
  "dispute-withdrawn": {
    label: "WITHDRAWN",
    dot: false,
    bg: "bg-03",
    text: "text-02",
    dotColor: "",
  },
  // ── `slash_proposals.status` (the operator console). The
  // OPPOSITE side of the polarity the `dispute-*` block above warns about:
  // here `UPHELD` means the PROPOSAL stands and the provider LOSES the money,
  // and `OVERTURNED` means the penalty is cancelled and the provider KEEPS it.
  // On a `disputes` row those two words point the other way round. So no label
  // below is the bare enum value either — every one names what it is a verdict
  // ON ("PENALTY …"), so that a badge lifted out of context onto a screen
  // about losing money cannot be read as the dispute's answer instead of the
  // proposal's. The tones follow the money, not the word: upheld/executed are
  // danger because the provider is out of pocket; overturned/reversed/waived
  // are success for the same reason.
  "case-proposed": {
    label: "PENALTY PROPOSED",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-disputed": {
    label: "PENALTY DISPUTED",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-under-review": {
    label: "PENALTY UNDER REVIEW",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-awaiting-second": {
    label: "AWAITING SECOND SIGNATURE",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-upheld": {
    label: "PENALTY UPHELD",
    dot: true,
    bg: "bg-danger-10",
    text: "text-danger-700",
    dotColor: "bg-danger-500",
  },
  "case-overturned": {
    label: "PENALTY OVERTURNED",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  "case-executing": {
    label: "PENALTY EXECUTING",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-executed": {
    label: "PENALTY EXECUTED",
    dot: true,
    bg: "bg-danger-10",
    text: "text-danger-700",
    dotColor: "bg-danger-500",
  },
  /*
    "COMPENSATED", not "REVERSED". The status column is still `REVERSED`, but
    the program has no `reverse_slash`: what happened is that the treasury paid the
    provider's stake back with an ordinary deposit. "Reversed" would tell a
    provider the chain undid the slash, which it cannot; "compensated" is what
    a bank statement would call it and what the money actually did.
  */
  "case-reversed": {
    label: "PENALTY COMPENSATED",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  "case-waived": {
    label: "PENALTY WAIVED",
    dot: true,
    bg: "bg-success-10",
    text: "text-success-700",
    dotColor: "bg-success-500",
  },
  /*
    Primary, not neutral: unlike `case-cancelled` this is not a resting state.
    The decision is taken and the money is still reserved on chain until the
    admin signs `cancel_slash`, so the badge has to read as something in flight.
  */
  "case-cancel-requested": {
    label: "CANCELLATION REQUESTED",
    dot: true,
    bg: "bg-primary-10",
    text: "text-primary-700",
    dotColor: "bg-primary-500",
  },
  "case-cancelled": {
    label: "PENALTY CANCELLED",
    dot: false,
    bg: "bg-03",
    text: "text-02",
    dotColor: "",
  },
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  variant: BadgeVariant;
}

function Badge({ variant, className, ...props }: BadgeProps) {
  const config = BADGE_VARIANTS[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold",
        config.bg,
        config.text,
        className
      )}
      {...props}
    >
      {config.dot && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dotColor)}
        />
      )}
      {config.label}
    </span>
  );
}

export { Badge, BADGE_VARIANTS };
