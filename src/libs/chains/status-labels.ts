/**
 * The words for an on-chain slash record's state, everywhere the app shows one.
 *
 * One table, so the penalties page (which reads the chain), the case pages
 * (which read the backend's mirror, `chainStatus`) and the operator console say
 * the same thing about the same state. Pure: no chain SDK, importable anywhere.
 *
 * Sources: assay-backend `ChainProposalStatus`
 * (`src/modules/slash/domain/chain-slash-outcome.ts`), the EVM cancel reasons
 * (`src/modules/chains/evm/evm-slash-status.ts`) and the `CHAIN_*` errors
 * (`src/modules/chains/errors/chains.errors.ts`).
 */

import { contractErrorNameInText, contractErrorText } from "./evm/contract-errors";

export const DISPUTED_ON_CHAIN_LABEL = "Disputed on chain — awaiting arbiter";
/**
 * `Pending` again after a dispute: the arbiter's `upholdSlash` ruled against
 * the provider. A record is disputed at most once, so it can only be executed.
 */
export const UPHELD_ON_CHAIN_LABEL = "Upheld by Assay's arbiter";
export const DISPUTE_UNRESOLVED_LABEL = "Dispute unresolved (30 days)";
export const PROGRAM_PAUSED_LABEL = "Contracts paused — try after unpause";
export const ADDRESS_BLOCKED_LABEL = "Blocked on chain";

/**
 * Who signs an on-chain cancel, by chain. `chain` is a CAIP-2 chain id or a
 * CAIP-19 asset id (only its namespace is read):
 *
 *  - EVM (`eip155:`): the arbiter. Assay builds `cancelSlash` for the arbiter
 *    only (assay-evm D-19); without one the build is `CHAIN_ARBITER_NOT_SET`.
 *  - Solana (`solana:`): the program admin, `Config.admin`.
 *
 * An unknown or missing chain names both rather than guess.
 */
export function cancelSignerOf(chain: string | null | undefined): string {
  if (chain?.startsWith("eip155:")) return "the arbiter";
  if (chain?.startsWith("solana:")) return "the program admin";
  return "the arbiter (EVM) or the program admin (Solana)";
}

/** `CANCEL_REQUESTED` in words, naming who has to sign on this chain. */
export function cancelRequestedLabel(chain: string | null | undefined): string {
  if (chain?.startsWith("eip155:")) return "Cancel requested — arbiter to sign";
  if (chain?.startsWith("solana:")) return "Cancel requested — program admin to sign";
  return "Cancel requested — arbiter (EVM) or program admin (Solana) to sign";
}

/** The backend's mirror of the on-chain record, `chainStatus`, as a case reads it. */
const CHAIN_STATUS_LABELS: Readonly<Record<string, string>> = {
  NONE: "Not on chain",
  PROPOSING: "Being proposed on chain",
  PENDING: "Pending on chain",
  DISPUTED: DISPUTED_ON_CHAIN_LABEL,
  EXECUTED: "Executed on chain",
  CANCELLED: "Cancelled on chain",
  REFUSED: "Refused by the chain",
};

/**
 * `chainStatus` in words. An unknown value is printed as it came, never
 * guessed at. `chain` (CAIP-2 or CAIP-19) names who signs a requested cancel.
 */
export function chainStatusLabel(status: string | null | undefined, chain?: string | null): string {
  if (!status) return "Not reported";
  if (status === "CANCEL_REQUESTED") return cancelRequestedLabel(chain);
  return CHAIN_STATUS_LABELS[status] ?? status;
}

/** The backend's mirror of a case's on-chain record, as the case clocks carry it. */
export interface CaseChainMirror {
  readonly chainStatus: string | null;
  /**
   * The backend's state derived per record (review N-4): it outranks the
   * case-level `chainDisputedAt`, which stays set after the arbiter cancels
   * one part while the others stand undisputed. Null off EVM.
   */
  readonly chainState: string | null;
}

/**
 * Where a case's on-chain record stands on the dispute path:
 *
 * - `disputed` — every live part is `Disputed`, awaiting the arbiter;
 * - `partly-disputed` — `PENDING` with some parts `Disputed`; the others keep executing;
 * - `upheld` — `PENDING` again with a `disputedAt` and no part disputed: the
 *   arbiter upheld the dispute (`upholdSlash`), and since a record is disputed
 *   at most once (`SlashAlreadyDisputed`) it can now only be executed;
 * - `none` — anything else, including a chain the backend does not mirror (`chainState` null).
 */
export type CaseChainDisputePhase = "disputed" | "partly-disputed" | "upheld" | "none";

export function caseChainDisputePhase(mirror: CaseChainMirror): CaseChainDisputePhase {
  if (mirror.chainStatus === "DISPUTED") return "disputed";
  if (mirror.chainStatus !== "PENDING") return "none";
  if (mirror.chainState === "DISPUTED") return "partly-disputed";
  return mirror.chainState === "UPHELD" ? "upheld" : "none";
}

/**
 * {@link chainStatusLabel}, told about an uphold: `PENDING` with a dispute
 * behind it reads as {@link UPHELD_ON_CHAIN_LABEL}, not as a fresh "Pending".
 */
export function caseChainStatusLabel(mirror: CaseChainMirror, chain?: string | null): string {
  if (caseChainDisputePhase(mirror) === "upheld") return UPHELD_ON_CHAIN_LABEL;
  return chainStatusLabel(mirror.chainStatus, chain);
}

/** Why a record was cancelled, as the backend names it (`WITHDRAWN`, …). */
const CANCEL_REASON_LABELS: Readonly<Record<string, string>> = {
  WITHDRAWN: "Cancelled by Assay's arbiter",
  EXPIRED: "Expired: nobody executed it in time",
  VERIFIER_UNAVAILABLE: "Verifier key no longer valid",
  DISPUTE_UNRESOLVED: DISPUTE_UNRESOLVED_LABEL,
};

export function chainCancelReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return CANCEL_REASON_LABELS[reason] ?? reason;
}

/**
 * The contract's `CancelReason` enum value (from a `SlashCancelled` log) in
 * words: `Withdrawn, Expired, VerifierUnavailable, DisputeUnresolved`.
 */
const CANCEL_REASON_BY_CODE: readonly string[] = [
  "WITHDRAWN",
  "EXPIRED",
  "VERIFIER_UNAVAILABLE",
  "DISPUTE_UNRESOLVED",
];

export function chainCancelReasonCodeLabel(code: number): string {
  const name = Number.isInteger(code) ? CANCEL_REASON_BY_CODE[code] : undefined;
  return name ? (CANCEL_REASON_LABELS[name] as string) : `Unknown reason (${String(code)})`;
}

/** The chain refusals a person can meet on any screen, in a few words. */
const CHAIN_ERROR_LABELS: Readonly<Record<string, string>> = {
  CHAIN_PROGRAM_PAUSED: PROGRAM_PAUSED_LABEL,
  CHAIN_ADDRESS_BLOCKED: ADDRESS_BLOCKED_LABEL,
  CHAIN_ARBITER_NOT_SET: "No arbiter appointed on chain",
  CHAIN_ADDRESS_ALREADY_BLOCKED: "Already blocked on chain",
  SLASH_CHAIN_BATCH_REFUSED: "The chain would refuse this batch",
};

/** A short label for a chain error code, or `null` when it is not one of these. */
export function chainErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return CHAIN_ERROR_LABELS[code] ?? null;
}

/**
 * `code · message` for a refusal, led by the short label when the code is a
 * chain refusal: "Contracts paused — try after unpause · CHAIN_PROGRAM_PAUSED · …".
 */
export function describeChainRefusal(error: { code: string; message: string }): string {
  const label = chainErrorLabel(error.code);
  const base = label ? `${label} · ${error.code} · ${error.message}` : `${error.code} · ${error.message}`;
  // A revert the backend names in its message (e.g. `… reverts SlashWindowNotDrained`), in words first.
  const revert = contractErrorText(contractErrorNameInText(error.message));
  return revert ? `${revert} · ${base}` : base;
}
