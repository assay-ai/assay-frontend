import type { BadgeVariant } from "@/components/ui/badge";
import { stampUtc } from "@/features/g34a/stats";
import type { Money } from "@/interfaces/api";
import type { OperatorRole, SlashProposalStatus } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";

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
 * `cancel` is not here: it is gated on the on-chain record, see
 * {@link isCancelRequested}.
 */
export type StatusGatedAction = Exclude<OperatorAction, "sweep" | "cancel">;

const ACTION_STATUSES: Record<StatusGatedAction, readonly SlashProposalStatus[]> = {
  claim: ["DISPUTED", "UNDER_REVIEW", "AWAITING_SECOND"],
  decide: ["DISPUTED", "UNDER_REVIEW"],
  second: ["AWAITING_SECOND"],
  suspend: ["PROPOSED", "DISPUTED", "UNDER_REVIEW", "AWAITING_SECOND", "UPHELD"],
  extendDeadline: ["PROPOSED"],
  compensate: ["EXECUTED"],
};

export function isLegalInStatus(action: StatusGatedAction, status: SlashProposalStatus): boolean {
  return ACTION_STATUSES[action].includes(status);
}

/**
 * `cancel` is gated on the **on-chain record**, not the case status.
 *
 * The backend's `buildCancelIntent` checks `chain_status === CANCEL_REQUESTED`
 * and nothing else about the case. That value is never a case status — an
 * overturned case waiting for the settlement admin still reads `OVERTURNED` —
 * so a status gate could never offer the action. The brief carries the chain
 * status for exactly this question.
 */
export function isCancelRequested(chainStatus: string | null | undefined): boolean {
  return chainStatus === "CANCEL_REQUESTED";
}

/**
 * How many of the case's parts are disputed on chain (`chainDisputedParts`,
 * audit E-4), in words, or `null` when none is. A dispute freezes only its own
 * part: while any part is still pending the case reads `PENDING` on chain and
 * those parts keep executing.
 */
export function disputedPartsNote(
  chainStatus: string | null | undefined,
  chainDisputedParts: number | null | undefined,
): string | null {
  if (!chainDisputedParts || chainDisputedParts <= 0) return null;
  const parts = `${chainDisputedParts} part${chainDisputedParts === 1 ? "" : "s"}`;
  if (chainStatus === "PENDING") {
    return `partly disputed: ${parts} disputed on chain, the other parts keep executing`;
  }
  return `${parts} disputed on chain`;
}

/**
 * The deadline that comes with a requested on-chain cancel, in plain words.
 *
 * `CANCEL_REQUESTED` means the platform has asked for the cancel and nothing
 * more: the record still stands on chain until the settlement admin signs, and
 * from its executable time **anyone** can execute the penalty. The brief
 * carries that time (`chainExecutableAt`); an older backend does not, and the
 * warning is then given without it rather than dropped.
 *
 * `null` for every other chain status — there is no cancel waiting.
 */
export function cancelDeadlineNotice(
  chainStatus: string | null | undefined,
  chainExecutableAt: string | null | undefined,
  now: Date,
): { overdue: boolean; text: string } | null {
  if (!isCancelRequested(chainStatus)) return null;

  const at = chainExecutableAt ? new Date(chainExecutableAt).getTime() : Number.NaN;
  if (!chainExecutableAt || Number.isNaN(at)) {
    return {
      overdue: false,
      text:
        "The cancel must be signed by the settlement admin before the on-chain record becomes "
        + "executable. After that anyone can execute the penalty.",
    };
  }
  if (now.getTime() >= at) {
    return {
      overdue: true,
      text:
        `The on-chain record became executable at ${stampUtc(chainExecutableAt)} UTC and the `
        + "cancel has not landed: anyone can execute the penalty now. Get the settlement admin's "
        + "signature immediately.",
    };
  }
  return {
    overdue: false,
    text:
      `The cancel must be signed by the settlement admin before ${stampUtc(chainExecutableAt)} `
      + "UTC. After that anyone can execute the penalty.",
  };
}

/**
 * What a successful Suspend tells the operator about the chain.
 *
 * `chainStatus` is the on-chain record's status **before** the suspension. The
 * backend closes the case and then requests the cancel of a standing record
 * (`PENDING` → `CANCEL_REQUESTED`); it signs nothing, so the suspension is not
 * finished until the settlement admin has signed.
 */
export function suspendedNotice(chainStatus: string | null | undefined): string {
  switch (chainStatus) {
    case "PENDING":
    case "CANCEL_REQUESTED":
      return (
        "Proposal suspended. The on-chain cancel has been requested and still needs the "
        + "settlement admin's signature."
      );
    case "PROPOSING":
      return (
        "Proposal suspended. A proposal was being written on chain; its cancel is requested when "
        + "it lands and will need the settlement admin's signature."
      );
    case "NONE":
    case "REFUSED":
    case "CANCELLED":
      return "Proposal suspended. Nothing stands on chain for it, so there is nothing to cancel.";
    default:
      return (
        "Proposal suspended. If a record stands on chain, its cancel has been requested and "
        + "still needs the settlement admin's signature."
      );
  }
}

/**
 * The roles a fleet sweep's **second approver** must hold — at least one.
 *
 * Mirrors `approverRoles` on the backend's `S-11` register row; any other
 * approver is refused with `403 OPERATOR_APPROVER_ROLE_REQUIRED`. The other
 * two-person action (recording a compensation, `S-5`) names none: any other
 * active operator may approve it.
 */
export const SWEEP_APPROVER_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL"];

/** `S-5`'s approver roles: the action's own — whoever records a treasury payment. */
export const COMPENSATION_APPROVER_ROLES: readonly OperatorRole[] = ["ADJL", "TRE"];

/** `S-1`'s approver roles, when a suspension is raised to two-person. */
export const SUSPEND_APPROVER_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL"];

/**
 * Whether a Suspend needs a second operator. From `AWAITING_SECOND` and
 * `UPHELD` a second person has confirmed the penalty or is confirming it, so
 * the backend raises `S-1` to two-person; in the earlier statuses one operator
 * suspends alone.
 */
export function suspendNeedsApprover(status: SlashProposalStatus): boolean {
  return status === "AWAITING_SECOND" || status === "UPHELD";
}

/**
 * `sweep` is the one action gated on the **outcome**, not the status.
 *
 * The backend's `openSweep` checks only
 * `OUTCOME_CONSEQUENCE[source.outcome].opensFleetSweep` and never looks at the
 * status. Gating it by status would be wrong in both directions:
 *
 *  - it would **offer `AWAITING_SECOND`**, where the proposal's `outcome` is
 *    still null — `decide` keeps the decision on the dispute until the second
 *    signature lands — so `openSweep` refuses there;
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

/**
 * Whether an action on `amountMinor` is above the operator's authority limit.
 *
 * `GET /operator/me` returns the limit and the backend refuses a `decide`,
 * `second` or `suspend` whose amount is above it with
 * `OPERATOR_AUTHORITY_EXCEEDED` — strictly above, so an amount equal to the
 * limit is allowed, and a null limit is unbounded. Compared as `BigInt` in
 * minor units, the way the backend compares it.
 *
 * An amount this cannot read is not blocked here: the backend still decides,
 * and a screen that guessed would withhold an action it had no grounds to.
 */
export function exceedsAuthority(limit: Money | null, amountMinor: string): boolean {
  if (limit === null) return false;
  if (!/^\d+$/.test(limit.amount) || !/^\d+$/.test(amountMinor)) return false;
  return BigInt(amountMinor) > BigInt(limit.amount);
}

/** Why an action above the authority limit is withheld — in money, not minor units. */
export function authorityRefusal(limit: Money, amount: Money): string {
  return `the penalty is ${formatMoney(amount)} and this token's authority limit is ${formatMoney(limit)}`;
}

/**
 * A recalculated penalty: minor units, digits only, positive, no leading zero.
 * The same pattern the backend's `DecideCaseBodyDto` enforces.
 */
export const RECALCULATED_AMOUNT_PATTERN = /^[1-9]\d{0,39}$/;
