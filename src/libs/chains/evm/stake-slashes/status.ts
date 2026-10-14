import {
  DISPUTED_ON_CHAIN_LABEL,
  UPHELD_ON_CHAIN_LABEL,
  chainCancelReasonCodeLabel,
} from "@/libs/chains/status-labels";

/**
 * `SlashStatus` and `CancelReason` from `assay-evm/src/Types.sol`, in words.
 *
 * ```text
 *  enum SlashStatus  { None, Pending, Executed, Cancelled, Disputed }
 *  enum CancelReason { Withdrawn, Expired, VerifierUnavailable, DisputeUnresolved }
 * ```
 *
 * `Disputed` (4) and `DisputeUnresolved` (3) come with the dispute upgrade
 * (D-19); a contract without it never writes them. Any value after those is
 * "Unknown status (n)" — shown, never thrown, and never folded into a known
 * state, because a page that guessed would be guessing about someone's stake.
 * The words themselves are shared with the case pages: `status-labels.ts`.
 */

/**
 * `upheld` is not a contract status: it is `Pending` (1) with a non-zero
 * `disputedAt`. The arbiter's `upholdSlash` moves a `Disputed` record back to
 * `Pending` and keeps `disputedAt`, and a record can be disputed only once
 * (`SlashAlreadyDisputed`), so such a record has no dispute window left: it
 * waits for its `executableAt` and is then executed. It is told apart because
 * a page that called it plain "Pending" would offer a dispute the chain refuses.
 */
export type SlashStatusKey =
  | "none"
  | "pending"
  | "upheld"
  | "executed"
  | "cancelled"
  | "disputed"
  | "unknown";

export interface SlashStatusInfo {
  readonly key: SlashStatusKey;
  /** The raw enum value read from the chain, kept for display and debugging. */
  readonly code: number;
  readonly label: string;
  /** Still open: stake is reserved and the provider has something to look at. */
  readonly needsAttention: boolean;
}

const KNOWN: Record<number, { key: SlashStatusKey; label: string; needsAttention: boolean }> = {
  0: { key: "none", label: "No record", needsAttention: false },
  1: { key: "pending", label: "Pending", needsAttention: true },
  2: { key: "executed", label: "Executed", needsAttention: false },
  3: { key: "cancelled", label: "Cancelled", needsAttention: false },
  4: { key: "disputed", label: DISPUTED_ON_CHAIN_LABEL, needsAttention: true },
};

export function slashStatusOf(code: number | bigint): SlashStatusInfo {
  const n = typeof code === "bigint" ? Number(code) : code;
  const known = Number.isInteger(n) ? KNOWN[n] : undefined;
  if (known) return { ...known, code: n };
  /*
    An unknown value is surfaced as needing attention: the chain says something
    this page cannot read, and the safe direction for a provider is to look.
  */
  return { key: "unknown", code: n, label: `Unknown status (${String(code)})`, needsAttention: true };
}

const UPHELD: { key: SlashStatusKey; label: string; needsAttention: boolean } = {
  key: "upheld",
  label: UPHELD_ON_CHAIN_LABEL,
  needsAttention: true,
};

/**
 * A record's status, told whether it was ever disputed (a non-zero
 * `disputedAt`, or a `SlashDisputed`/`SlashUpheld` log): `Pending` with a
 * dispute behind it is `upheld`. Every other status reads as {@link slashStatusOf}.
 */
export function slashRecordStatusOf(code: number | bigint, everDisputed: boolean): SlashStatusInfo {
  const status = slashStatusOf(code);
  return status.key === "pending" && everDisputed ? { ...UPHELD, code: status.code } : status;
}

/** A `SlashCancelled.reason`, in words. An unknown value says so rather than guessing. */
export function cancelReasonLabel(reason: number | bigint | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  return chainCancelReasonCodeLabel(typeof reason === "bigint" ? Number(reason) : reason);
}
