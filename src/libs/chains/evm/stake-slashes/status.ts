/**
 * `SlashStatus` and `CancelReason` from `assay-evm/src/Types.sol`, in words.
 *
 * ```text
 *  enum SlashStatus  { None, Pending, Executed, Cancelled }   // today
 *                    { …, Cancelled, Disputed }                // being added: 4
 *  enum CancelReason { Withdrawn, Expired, VerifierUnavailable }
 * ```
 *
 * `Disputed` is mapped already, so the day the contract starts writing 4 this
 * page says "Disputed" without a release. Any value after that is "Unknown
 * status (n)" — shown, never thrown, and never folded into a known state,
 * because a page that guessed would be guessing about someone's stake.
 */

export type SlashStatusKey = "none" | "pending" | "executed" | "cancelled" | "disputed" | "unknown";

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
  4: { key: "disputed", label: "Disputed", needsAttention: true },
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

const CANCEL_REASONS: Record<number, string> = {
  0: "Withdrawn by Assay",
  1: "Expired: nobody executed it in time",
  2: "Verifier key no longer valid",
};

/** A `SlashCancelled.reason`, in words. An unknown value says so rather than guessing. */
export function cancelReasonLabel(reason: number | bigint | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const n = typeof reason === "bigint" ? Number(reason) : reason;
  return CANCEL_REASONS[n] ?? `Unknown reason (${String(reason)})`;
}
