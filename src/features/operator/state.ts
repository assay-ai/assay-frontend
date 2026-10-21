import { stampUtc } from "@/features/g34a/stats";
import type { OperatorRole, SlashProposalStatus } from "@/interfaces/operator";
import { cancelSignerOf } from "@/libs/chains/status-labels";

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
  "PROPOSED", "UPHELD", "OVERTURNED", "EXECUTING", "EXECUTED",
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

/**
 * What this operator may do.
 *
 * Read off `GET /operator/me` rather than assumed, so the console never offers
 * an action the guard will refuse. Mirrors the `@RequireRoles` decorators on
 * the backend's operator cases controller.
 */
const ACTION_ROLES = {
  /*
    `compensate` inherits `reverse`'s roles unchanged — the act it replaces is
    the same act, and `TRE` is here because the treasury is the account that
    actually pays. Its record half is two-person: see `TWO_PERSON_ACTIONS`.
  */
  compensate: ["ADJL", "TRE"],
  /* `cancel-intent` guards the same pair as `compensation-intent`. */
  cancel: ["ADJL", "TRE"],
  /*
    B18: the stuck-cancel actions, by the pair that handles the cancels to
    sign. Close is one person (`S-15`); record (`S-16`) and re-propose
    (`S-17`) are two-person, see `TWO_PERSON_ACTIONS`.
  */
  closeCancel: ["ADJL", "TRE"],
  recordExecution: ["ADJL", "TRE"],
  repropose: ["ADJL", "TRE"],
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
export type StatusGatedAction = Exclude<OperatorAction, "cancel" | "closeCancel" | "recordExecution" | "repropose">;
/* The B18 actions are gated on the brief's live chain read (`manualActions`), never on the status alone. */

const ACTION_STATUSES: Record<StatusGatedAction, readonly SlashProposalStatus[]> = {
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
 * more: the record still stands on chain until its signer signs — the arbiter
 * on EVM, the program admin on Solana (`cancelSignerOf`; `chain` is the case
 * penalty's CAIP-19 asset or a CAIP-2 chain id) — and
 * from its executable time **anyone** can execute the penalty. The brief
 * carries that time (`chainExecutableAt`); when it is null the warning is
 * given without it rather than dropped.
 *
 * "Anyone can execute" only while something stands: with `chainRecord`
 * GONE (the brief's own reading) there is nothing to execute and nothing to
 * sign, whatever the dates say; EXECUTED means the stake was already taken;
 * UNKNOWN (not confirmed) says so instead of a warning it cannot back.
 *
 * `null` for every other chain status — there is no cancel waiting.
 */
export function cancelDeadlineNotice(
  chainStatus: string | null | undefined,
  chainExecutableAt: string | null | undefined,
  now: Date,
  chain?: string | null,
  chainRecord?: "STANDING" | "EXECUTED" | "GONE" | "UNKNOWN",
): { overdue: boolean; text: string } | null {
  if (!isCancelRequested(chainStatus)) return null;
  if (chainRecord === "EXECUTED") {
    return { overdue: true, text: "Executed on chain while the cancel waited: the stake was taken. Nothing can be cancelled any more." };
  }
  if (chainRecord === "GONE") {
    return { overdue: false, text: "Nothing is on chain: nothing can be executed, and there is nothing to sign." };
  }
  const signer = cancelSignerOf(chain);
  // Not confirmed standing: never "anyone can execute" (V1-15).
  if (chainRecord === "UNKNOWN") {
    const at = chainExecutableAt ? Date.parse(chainExecutableAt) : Number.NaN;
    return {
      overdue: !Number.isNaN(at) && now.getTime() >= at,
      text:
        (!Number.isNaN(at) && now.getTime() >= at ? "If the penalty still stands on chain, its deadline has passed. " : "")
        + "We could not confirm what stands on chain for this penalty. Signing the cancel reads the chain first "
        + `and says whether there is anything for ${signer} to sign.`,
    };
  }

  const at = chainExecutableAt ? new Date(chainExecutableAt).getTime() : Number.NaN;
  if (!chainExecutableAt || Number.isNaN(at)) {
    return {
      overdue: false,
      text:
        `The cancel must be signed by ${signer} before the on-chain record becomes `
        + "executable. After that anyone can execute the penalty.",
    };
  }
  if (now.getTime() >= at) {
    return {
      overdue: true,
      text:
        `The on-chain record became executable at ${stampUtc(chainExecutableAt)} UTC and the `
        + `cancel has not landed: anyone can execute the penalty now. Get ${signer}'s `
        + "signature immediately.",
    };
  }
  return {
    overdue: false,
    text:
      `The cancel must be signed by ${signer} before ${stampUtc(chainExecutableAt)} `
      + "UTC. After that anyone can execute the penalty.",
  };
}

/**
 * The case actions that are two-person on the backend: answered
 * `202 { approvalId }` and run once a second operator approves them in the
 * approvals inbox. For `compensate` only the record half (`compensated`,
 * `S-5`) is; building the deposit is `@OverrideExempt`, because unsigned bytes
 * change nothing.
 */
export const TWO_PERSON_ACTIONS: readonly OperatorAction[] = Object.freeze([
  "compensate",
  "recordExecution",
  "repropose",
]);
