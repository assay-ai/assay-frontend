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

/** Why a record was cancelled, as the backend names it (`WITHDRAWN`, …). */
const CANCEL_REASON_LABELS: Readonly<Record<string, string>> = {
  WITHDRAWN: "Withdrawn by Assay",
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
