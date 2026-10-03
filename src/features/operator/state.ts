import type { BadgeVariant } from "@/components/ui/badge";
import type { OperatorRole, SlashProposalStatus } from "@/interfaces/operator";

import { SWEEPABLE_OUTCOMES } from "./reason-codes";

/**
 * Status narrowing, status → badge, and roles → what the console offers.
 *
 * ## The polarity trap
 *
 * `UPHELD` on a **slash proposal** means the proposal stands and the provider
 * loses. `UPHELD` on a **dispute** means the objection stands and the provider
 * wins. Both are settled usage in their own table. Everything here is about
 * the proposal.
 *
 * ## `REVERSED` no longer means the program reversed anything
 *
 * `reverse_slash` is gone. The status now means the treasury compensated the
 * provider with a `deposit_stake` and an operator recorded the confirmed
 * signature — same column, same badge, different mechanism. `CANCEL_REQUESTED`
 * is its counterpart on the other door: a decision taken, waiting on a
 * signature this platform cannot produce.
 */

const SLASH_PROPOSAL_STATUSES: readonly SlashProposalStatus[] = Object.freeze([
  "PROPOSED", "DISPUTED", "UNDER_REVIEW", "AWAITING_SECOND",
  "UPHELD", "OVERTURNED", "EXECUTING", "EXECUTED",
  "REVERSED", "WAIVED", "CANCEL_REQUESTED", "CANCELLED",
]);

/**
 * Narrow the case brief's `status`, which the provider-side interface types as
 * a bare `string` rather than a union.
 *
 * Returns `null` on anything unrecognised rather than asserting, so a status
 * added on the backend renders as unknown instead of crashing a screen an
 * adjudicator is holding a deadline on.
 */
export function asProposalStatus(status: string): SlashProposalStatus | null {
  return (SLASH_PROPOSAL_STATUSES as readonly string[]).includes(status)
    ? (status as SlashProposalStatus)
    : null;
}

export function caseBadgeVariant(status: SlashProposalStatus): BadgeVariant {
  switch (status) {
    case "PROPOSED": return "case-proposed";
    case "DISPUTED": return "case-disputed";
    case "UNDER_REVIEW": return "case-under-review";
    case "AWAITING_SECOND": return "case-awaiting-second";
    case "UPHELD": return "case-upheld";
    case "OVERTURNED": return "case-overturned";
    case "EXECUTING": return "case-executing";
    case "EXECUTED": return "case-executed";
    case "REVERSED": return "case-reversed";
    case "WAIVED": return "case-waived";
    case "CANCEL_REQUESTED": return "case-cancel-requested";
    case "CANCELLED": return "case-cancelled";
  }
}

export function caseStatusLabel(status: SlashProposalStatus): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/**
 * What this token may do.
 *
 * Read off `GET /operator/me` rather than assumed, so the console never offers
 * an action the guard will refuse. Mirrors the `@RequireRoles` decorators on
 * the backend's operator cases controller; `suspend` really does include `SRE`.
 */
const ACTION_ROLES = {
  claim: ["ADJ", "ADJL"],
  decide: ["ADJ", "ADJL"],
  second: ["ADJ", "ADJL"],
  suspend: ["ADJ", "ADJL", "SRE"],
  extendDeadline: ["ADJL"],
  sweep: ["ADJL"],
  /*
    `compensate` inherits `reverse`'s roles unchanged — the act it replaces is
    the same act, and `TRE` is here because the treasury is the account that
    actually pays. What it no longer inherits is the second operator token: see
    `TWO_PERSON_ACTIONS` below.
  */
  compensate: ["ADJL", "TRE"],
  /* `cancel-intent` guards the same pair as `compensation-intent`. */
  cancel: ["ADJL", "TRE"],
} as const satisfies Record<string, readonly OperatorRole[]>;

export type OperatorAction = keyof typeof ACTION_ROLES;

export function may(roles: readonly OperatorRole[], action: OperatorAction): boolean {
  const allowed: readonly OperatorRole[] = ACTION_ROLES[action];
  return roles.some((role) => allowed.includes(role));
}

/**
 * Which statuses each action is legal in — read off the backend, not guessed.
 *
 * `compensate` keeps `reverse`'s `EXECUTED`: nothing was taken from a provider
 * whose penalty never executed, so there is nothing to put back.
 *
 * `cancel` is legal in `CANCEL_REQUESTED` and nowhere else. That status exists
 * precisely because the backend cannot cancel on chain by itself any more — it
 * records the overturn and parks the case there until the admin signs.
 */
const ACTION_STATUSES: Record<Exclude<OperatorAction, "sweep">, readonly SlashProposalStatus[]> = {
  claim: ["DISPUTED", "UNDER_REVIEW", "AWAITING_SECOND"],
  decide: ["DISPUTED", "UNDER_REVIEW"],
  second: ["AWAITING_SECOND"],
  suspend: ["PROPOSED", "DISPUTED", "UNDER_REVIEW", "AWAITING_SECOND", "UPHELD"],
  extendDeadline: ["PROPOSED"],
  compensate: ["EXECUTED"],
  cancel: ["CANCEL_REQUESTED"],
};

export function isLegalInStatus(
  action: Exclude<OperatorAction, "sweep">,
  status: SlashProposalStatus,
): boolean {
  return ACTION_STATUSES[action].includes(status);
}

/**
 * `sweep` is the one action gated on the **outcome**, not the status.
 *
 * The backend's `openSweep` checks only
 * `OUTCOME_CONSEQUENCE[source.outcome].opensFleetSweep` and never looks at the
 * status. Gating it by status would be wrong in both directions:
 *
 *  - it would **miss `AWAITING_SECOND`**, where a sweep is perfectly legal —
 *    `decide` writes `outcome` even when it defers the second signature, and
 *    only `resolvedAt` is held back;
 *  - it would **offer `UPHELD`**, which is only ever produced by the two
 *    upholding outcomes, both of which have `opensFleetSweep: false`. The
 *    button would render and 422 every time.
 */
export function isSweepable(outcome: string | null): boolean {
  return outcome !== null
    && (SWEEPABLE_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * The actions that need a second operator's token in `X-Operator-Approver`.
 *
 * `compensate` is here because it inherited `reverse`'s override-register row
 * `S-5` — but only **half** of it does. The action is two calls with different
 * guards: `compensation-intent` is `@OverrideExempt` (unsigned bytes nobody has
 * signed change nothing, so there is nothing for a maker/checker pair to
 * guard), and `compensated` is the `S-5` write that closes the case.
 *
 * The chain signature and the approver token answer different questions, which
 * is why the multisig does not make the token redundant: the signature says the
 * treasury moved the money, the token says two of our people agreed to close
 * the case on the strength of it. Neither substitutes for the other.
 *
 * A per-action list cannot express "the second call only", so the panel is
 * where that lives — the approver field renders on the record step and not on
 * the build step.
 */
export const TWO_PERSON_ACTIONS: readonly OperatorAction[] = Object.freeze([
  "sweep",
  "compensate",
]);
