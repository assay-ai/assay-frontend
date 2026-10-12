import Decimal from "decimal.js";

import type { EscrowLimitsBody } from "@/interfaces";
import { exceedsScale, toAtomic } from "@/utils/money";

/**
 * The buyer's two on-chain escrow limits, and the validation the
 * `/funding/escrow/limits` screen submits through.
 *
 * **`"0"` is never produced by an empty field.** `POST /escrow/limits-intent`
 * treats `"0"` as a deliberate "refuse every redemption" — not "no limit", not
 * "unset". An empty input therefore has to fail validation outright rather
 * than default to `"0"`; the only way `"0"` reaches the wire is a user who
 * typed it and then ticked `confirmZero`.
 */

/**
 * USDC's scale. The MVP settles in one asset (see `symbolForAsset` in
 * `@/utils/money`), so this mirrors `DEPOSIT_DECIMALS` in
 * `funding/deposit/page.tsx` rather than reading a config: there is nowhere
 * else in this API that publishes it ahead of an escrow existing. Once an
 * escrow exists, `BuyerEscrow.maxVoucherAmount.decimals` is the same number,
 * read off the wire — callers should prefer that when they have it and fall
 * back to this constant only before an escrow's first read.
 */
export const ESCROW_LIMITS_DECIMALS = 6;

export interface LimitsFormInput {
  maxVoucherAmount: string;
  maxPerWindow: string;
  /**
   * Whether the person has ticked "yes, a zero limit is what I want". Only
   * consulted when one of the two amounts parses to zero; a plain non-zero
   * submission never needs it.
   */
  confirmZero: boolean;
}

export interface LimitsFormErrors {
  maxVoucherAmount?: string;
  maxPerWindow?: string;
  /** Set only when a zero amount was typed and `confirmZero` was not ticked. */
  confirmZero?: string;
}

export type LimitsFormField = "maxVoucherAmount" | "maxPerWindow";

export type ParsedLimitsForm =
  | { ok: true; body: EscrowLimitsBody; zeroFields: LimitsFormField[] }
  | { ok: false; errors: LimitsFormErrors };

function parseOneLimit(
  raw: string,
  decimals: number,
): { ok: true; value: Decimal } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "Enter a limit." };
  // A leading "-" is admitted here so a negative amount reaches the
  // `isNegative` check below and gets its own sentence, rather than being
  // folded into the generic "not a number" message.
  if (!/^-?\d*\.?\d*$/.test(trimmed) || trimmed === "." || trimmed === "-") {
    return { ok: false, error: "Enter a plain number." };
  }

  let value: Decimal;
  try {
    value = new Decimal(trimmed);
  } catch {
    return { ok: false, error: "Enter a plain number." };
  }

  if (value.isNegative()) return { ok: false, error: "Cannot be negative." };
  if (exceedsScale(value, decimals)) {
    return { ok: false, error: `Goes to ${decimals} decimal places at most.` };
  }

  return { ok: true, value };
}

/**
 * Pure validation for the on-chain limits form. No network call, no React —
 * this is the seam the "blank field never submits" and "zero must be
 * confirmed" rules are tested against directly.
 */
export function parseLimitsForm(
  input: LimitsFormInput,
  decimals: number = ESCROW_LIMITS_DECIMALS,
): ParsedLimitsForm {
  const voucher = parseOneLimit(input.maxVoucherAmount, decimals);
  const window = parseOneLimit(input.maxPerWindow, decimals);

  const errors: LimitsFormErrors = {};
  if (!voucher.ok) errors.maxVoucherAmount = voucher.error;
  if (!window.ok) errors.maxPerWindow = window.error;
  if (!voucher.ok || !window.ok) return { ok: false, errors };

  // A single call can never be charged more than the window allows, so a
  // per-call ceiling above it is a typo, not a setting. A zero window is the
  // "refuse everything" case and has its own confirmation below.
  if (!window.value.isZero() && voucher.value.gt(window.value)) {
    return {
      ok: false,
      errors: { maxVoucherAmount: "Cannot be more than the per-window limit." },
    };
  }

  const zeroFields: LimitsFormField[] = [];
  if (voucher.value.isZero()) zeroFields.push("maxVoucherAmount");
  if (window.value.isZero()) zeroFields.push("maxPerWindow");

  if (zeroFields.length > 0 && !input.confirmZero) {
    return {
      ok: false,
      errors: {
        confirmZero:
          "A zero limit refuses every paid call through this escrow. Check the box to confirm that is what you want.",
      },
    };
  }

  return {
    ok: true,
    body: {
      maxVoucherAmount: toAtomic(voucher.value, decimals),
      maxPerWindow: toAtomic(window.value, decimals),
    },
    zeroFields,
  };
}

/**
 * What the page's submit button actually calls. `createIntent` is injected —
 * never imported and called directly here — so the "a blank field must not
 * reach `createEscrowLimitsIntent`" rule is checkable without mounting a
 * component: a test passes a spy in its place and asserts it was never
 * invoked when `parseLimitsForm` rejects the input.
 */
export async function submitLimitsForm<T>(
  input: LimitsFormInput,
  createIntent: (body: EscrowLimitsBody) => Promise<T>,
  decimals: number = ESCROW_LIMITS_DECIMALS,
): Promise<ParsedLimitsForm> {
  const parsed = parseLimitsForm(input, decimals);
  if (parsed.ok) {
    await createIntent(parsed.body);
  }
  return parsed;
}

/**
 * Whether an escrow exists but refuses every redemption — the state a lean-v3
 * escrow is *born in*.
 *
 * `open_escrow` lets any signer pay the rent, because the platform fronts it
 * when it onboards a buyer. What a bare signer may **not** do is set a non-zero
 * limit: the limits are what bound a compromised backend, and a backend that
 * chose them at open would be bounding itself. So an escrow this platform
 * opened comes up **disarmed** — both limits `"0"`, every redemption refused —
 * and only a `set_escrow_limits` signed by the buyer's own wallet arms it.
 *
 * That is a correct security property and a terrible surprise. A buyer who has
 * deposited and whose calls all fail has a funded account that looks healthy on
 * every screen: the balance is right, the escrow exists, nothing is pending.
 * This predicate is what lets the funding screens say the actual reason.
 *
 * `null` when there is no escrow at all — a different errand (deposit first),
 * and not something to describe as "disarmed".
 *
 * **`exists: null` — the chain could not be read — answers `false` too**, and
 * that is the right direction rather than an accident of `!escrow?.exists`:
 * "your escrow refuses every call" is a present-tense claim about an account
 * nobody managed to look at. The page renders the unreadable block instead.
 * Widened from `boolean` on 2026-09-11 when `BuyerEscrow.exists` was corrected
 * to `boolean | null`; the behaviour was already what it should be, and the
 * type is what changed.
 */
export function isEscrowDisarmed(escrow: {
  exists: boolean | null;
  maxVoucherAmount: { amount: string } | null;
  maxPerWindow: { amount: string } | null;
} | null | undefined): boolean {
  if (!escrow?.exists) return false;
  // Absent is not zero. A limit the server could not read is unknown, and
  // telling a buyer their escrow is disarmed on the strength of a missing
  // field would send them to sign a transaction they may not need.
  if (!escrow.maxVoucherAmount || !escrow.maxPerWindow) return false;
  // Either one at zero refuses every redemption on its own: `redeem_voucher`
  // checks both, so "disarmed" is an OR, not an AND.
  return isZeroAmount(escrow.maxVoucherAmount.amount)
    || isZeroAmount(escrow.maxPerWindow.amount);
}

/** `"0"`, `"000"` and `""` are all the same atomic amount; `Number()` is not involved. */
function isZeroAmount(amount: string): boolean {
  return /^0*$/.test(amount.trim());
}

/**
 * Whether a read of the escrow already shows the limits the buyer signed.
 *
 * Needed because "the write landed" and "a read shows it" are not the same
 * moment. Measured on eip155:46630: the relayed SetLimits came back mined, the
 * single refetch fired right after it still read 0 / 0 (an RPC answering a
 * block behind the receipt), and "Currently set" stayed at $0.00 under
 * "Done — your new limits are on chain" until a full reload.
 */
export function limitsLanded(
  escrow: { maxVoucherAmount: { amount: string } | null; maxPerWindow: { amount: string } | null } | null | undefined,
  signed: EscrowLimitsBody,
): boolean {
  if (!escrow?.maxVoucherAmount || !escrow.maxPerWindow) return false;
  return (
    BigInt(escrow.maxVoucherAmount.amount) === BigInt(signed.maxVoucherAmount) &&
    BigInt(escrow.maxPerWindow.amount) === BigInt(signed.maxPerWindow)
  );
}

export const LIMITS_LANDING_POLL_MS = 2_000;
export const LIMITS_LANDING_TIMEOUT_MS = 30_000;

/**
 * The escrow query's `refetchInterval` after a successful write: poll until the
 * read shows the signed limits, then stop — and stop anyway after a bounded
 * wait, so a read that never catches up costs a few requests, not a loop.
 */
export function limitsLandingInterval(
  escrow: Parameters<typeof limitsLanded>[0],
  awaiting: { body: EscrowLimitsBody; since: number } | null,
  now: number,
): number | false {
  if (!awaiting) return false;
  if (now - awaiting.since > LIMITS_LANDING_TIMEOUT_MS) return false;
  return limitsLanded(escrow, awaiting.body) ? false : LIMITS_LANDING_POLL_MS;
}
