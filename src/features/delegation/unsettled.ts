import Decimal from "decimal.js";

import { type DelegationFormInput, findDelegation } from "@/features/delegation/delegation-form";
import type { EscrowDelegate, Money, UnsettledVouchers } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * Payments still being settled, and the caps that would strand them
 * (BUG-D1-07). Pure: no React, no network.
 *
 * A paid call is served minutes before the chain redeems its voucher, and the
 * chain applies the caps standing AT REDEMPTION. Lower the per-payment cap
 * below one of them, or the 24-hour cap below the counter plus them, or the
 * expiry below when they can still be redeemed, or revoke the key, and the
 * chain refuses them: the provider worked and nobody pays. The backend refuses
 * such a change unless it is acknowledged; this is the same rule, so the
 * screen can say so before anything is built or signed.
 */

/** How often a screen waiting for payments to settle reads them again. */
export const UNSETTLED_POLL_MS = 5_000;

/**
 * How long "Wait for them to settle" waits before saying the agent is still
 * paying (review finding 9): an agent that keeps paying keeps adding payments
 * under the old caps, so the count may never reach zero on its own.
 */
export const UNSETTLED_WAIT_MAX_MS = 120_000;

/** The backend's refusal of a change that would strand payments still being settled. */
export const UNSETTLED_AT_RISK_CODE = "SETTLEMENT_UNSETTLED_VOUCHERS_AT_RISK";

export type StrandReason = "maxVoucherAmount" | "maxPerWindow" | "validUntil" | "revoked";

/** Caps in atomic units (decimal strings); `validUntil` in unix seconds, when it applies. */
export interface AtomicCaps {
  maxVoucherAmount: string;
  maxPerWindow: string;
  validUntil?: string;
}

const atomic = (value: Money | string): bigint =>
  BigInt(typeof value === "string" ? value : value.amount);

/**
 * True when the payer's escrow keeps signed payments collectable for a while
 * after a tightening (assay-evm D-21): `tightenDelaySeconds` above 0 on
 * `GET /escrow/unsettled` or `GET /escrow/delegates`. Nothing can be stranded
 * there, so the backend refuses nothing for it. Absent (an older API) is 0.
 */
export function hasTightenDelay(tightenDelaySeconds: number | null | undefined): boolean {
  return typeof tightenDelaySeconds === "number" && tightenDelaySeconds > 0;
}

/** "1 hour", "2 hours", "30 minutes": the delay as the screen says it. */
export function tightenDelayLabel(tightenDelaySeconds: number): string {
  if (tightenDelaySeconds % 3_600 === 0) {
    const hours = tightenDelaySeconds / 3_600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.max(1, Math.round(tightenDelaySeconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The Revoke sheet, on an escrow with the tighten delay (D-21). */
export function revokeDelayedText(tightenDelaySeconds: number): string {
  return (
    `Payments your agent already signed can still be collected for ${tightenDelayLabel(tightenDelaySeconds)}, ` +
    "so providers you already used get paid. New paid calls stop now."
  );
}

/** Lowering escrow limits or a delegate's caps, on an escrow with the tighten delay (D-21). */
export function loweredDelayedText(tightenDelaySeconds: number): string {
  return (
    "New payments get the lower limits now; payments your agent already signed keep the old ones for " +
    `${tightenDelayLabel(tightenDelaySeconds)}.`
  );
}

/**
 * When a lowering binds every payment, the ones already signed included: now
 * plus the escrow's tighten delay (D-21), as an ISO instant, or null without a
 * delay (then it binds at once).
 */
export function loweredFullyAt(nowMs: number, tightenDelaySeconds: number | null | undefined): string | null {
  return hasTightenDelay(tightenDelaySeconds) ? new Date(nowMs + tightenDelaySeconds! * 1000).toISOString() : null;
}

/** What the Revoke sheet says about signed payments, or null to keep the strand warning. */
export function revokeDelayNote(tightenDelaySeconds: number | null | undefined): string | null {
  return hasTightenDelay(tightenDelaySeconds) ? revokeDelayedText(tightenDelaySeconds!) : null;
}

/**
 * What a screen lowering limits says instead of the strand warning (D-21), or
 * null: only on an escrow with the delay, and only when `next` lowers something.
 */
export function loweredDelayNote(
  tightenDelaySeconds: number | null | undefined,
  current: AtomicCaps | null | undefined,
  next: AtomicCaps | null | undefined,
): string | null {
  if (!hasTightenDelay(tightenDelaySeconds) || !current || !next) return null;
  return lowersCaps(current, next) ? loweredDelayedText(tightenDelaySeconds!) : null;
}

/**
 * What a lowering does, said BEFORE signing (review 2026-10-17 P2-11): with
 * the tighten delay (D-21) the delayed-apply note; without it, the ~30-second
 * pause the backend puts on the agents' payments while it lands; and when the
 * delay could not be read (`tightenDelaySeconds === undefined`), the honest
 * "may pause briefly". `null` when nothing goes down.
 */
export function loweringBeforeSignNote(
  tightenDelaySeconds: number | null | undefined,
  current: AtomicCaps | null | undefined,
  next: AtomicCaps | null | undefined,
): string | null {
  if (!current || !next || !lowersCaps(current, next)) return null;
  if (hasTightenDelay(tightenDelaySeconds)) return loweredDelayedText(tightenDelaySeconds!);
  if (tightenDelaySeconds === undefined) {
    return "Lower than now: your agents' payments may pause briefly while it lands.";
  }
  return "Lower than now: your agents' payments pause for about 30 seconds while it lands.";
}

/**
 * A lowering when the payments still being settled could not be read: the
 * screen cannot tell whether it strands any, so it says that it may, and what
 * that costs (P2-11).
 */
export const LOWERING_UNREAD_NOTE =
  "Lower than now. Its payments may pause briefly while the lower limits land. Payments still being settled " +
  "could not be checked: if any no longer fit, each becomes a payment you owe, and paid calls pause until you " +
  "sign it again. Waiting about a minute after its last call avoids this.";

/** True when `next` lowers either cap, or (when both carry one) the expiry. */
export function lowersCaps(current: AtomicCaps, next: AtomicCaps): boolean {
  return (
    BigInt(next.maxVoucherAmount) < BigInt(current.maxVoucherAmount) ||
    BigInt(next.maxPerWindow) < BigInt(current.maxPerWindow) ||
    (next.validUntil !== undefined &&
      current.validUntil !== undefined &&
      BigInt(next.validUntil) < BigInt(current.validUntil))
  );
}

/**
 * Why the chain would refuse a payment still being settled once `next` stands.
 * Only a cap that goes DOWN counts: a cap that stays or rises cannot strand a
 * payment that fits today. Empty when nothing is unsettled, and always empty on
 * an escrow with the tighten delay (`tightenDelaySeconds` above 0, D-21): a
 * tightening binds signed payments only after the delay, so none is stranded.
 */
export function strandReasons(
  unsettled: UnsettledVouchers | null | undefined,
  current: AtomicCaps,
  next: AtomicCaps | "revoke",
  tightenDelaySeconds?: number | null,
): StrandReason[] {
  if (hasTightenDelay(tightenDelaySeconds)) return [];
  if (!unsettled || unsettled.count === 0) return [];
  if (next === "revoke") return ["revoked"];
  const reasons: StrandReason[] = [];
  const perPayment = BigInt(next.maxVoucherAmount);
  if (perPayment < BigInt(current.maxVoucherAmount) && atomic(unsettled.largest) > perPayment) {
    reasons.push("maxVoucherAmount");
  }
  const perWindow = BigInt(next.maxPerWindow);
  if (perWindow < BigInt(current.maxPerWindow) && atomic(unsettled.windowNeeds) > perWindow) {
    reasons.push("maxPerWindow");
  }
  if (
    next.validUntil !== undefined &&
    current.validUntil !== undefined &&
    BigInt(next.validUntil) < BigInt(current.validUntil) &&
    unsettled.redeemableUntil !== null &&
    Number(next.validUntil) * 1000 < Date.parse(unsettled.redeemableUntil)
  ) {
    reasons.push("validUntil");
  }
  return reasons;
}

/**
 * The toast after an edit landed. The backend pauses the delegate's payments
 * for about 30 seconds after any cap, or the expiry, goes DOWN (it refuses
 * them with PAYMENT_VOUCHER_ADMISSION_PAUSED), so the toast must not promise
 * "the next payment" then (BUG-R3-J-04). On an escrow with the tighten delay
 * (D-21) there is no pause: new payments get the lower caps at once, payments
 * already signed after the delay.
 */
export function editedToast(
  current: AtomicCaps | null,
  next: AtomicCaps,
  tightenDelaySeconds?: number | null,
): string {
  const lowered = current !== null && lowersCaps(current, next);
  if (lowered && hasTightenDelay(tightenDelaySeconds)) {
    return `Updated. The new caps apply from the agent’s next payment. ${loweredDelayedText(tightenDelaySeconds!)}`;
  }
  return lowered
    ? "Updated. The agent’s payments are paused for about 30 seconds while the change settles; then the new caps apply."
    : "Updated. The new caps apply from the agent’s next payment.";
}

/**
 * "2 payments ($0.60) still being settled", or null when there are none.
 * Money in dollars at two decimals (sub-cent amounts keep their digits).
 * `_unit` is kept for callers that still pass the token symbol.
 */
export function unsettledLine(
  unsettled: UnsettledVouchers | null | undefined,
  _unit?: string,
): string | null {
  if (!unsettled || unsettled.count === 0) return null;
  const value = toDecimal(unsettled.amount);
  const amount = formatMoney(unsettled.amount, { decimals: !value.isZero() && value.lt("0.01") ? 4 : 2 });
  return `${unsettled.count} payment${unsettled.count === 1 ? "" : "s"} (${amount}) still being settled`;
}

const REASON_TEXT: Record<StrandReason, string> = {
  maxVoucherAmount: "one of them is larger than the new per-payment limit",
  maxPerWindow: "together they no longer fit the new 24-hour limit",
  validUntil: "the new expiry comes before they can be redeemed",
  revoked: "a revoked key's payments cannot be redeemed",
};

/**
 * What a stranded payment turns into (assay-backend
 * `voucher-redemption.service.ts` BUYER_TIGHTENING_ERRORS, review-buyer-debt
 * M3): the chain refuses it, the platform retries until about a minute before
 * the voucher's on-chain deadline (about 35 minutes after it was signed), and
 * a re-grant or a raised cap in that time makes it redeemable again. After
 * that it becomes BUYER DEBT: the buyer owes it, paid calls are refused until
 * the buyer signs it again, free calls keep working.
 */
const STRAND_CONSEQUENCE =
  "becomes a payment you owe: your paid calls pause until you sign it again (Settle in the banner). " +
  "Free calls keep working.";

/** What the screen says about a change that strands them. */
export function strandWarning(reasons: readonly StrandReason[], count: number): string {
  const them = count === 1 ? "it" : "them";
  const why = reasons.map((r) => REASON_TEXT[r]).join("; ");
  return (
    `This change would leave ${them} unredeemable${why ? ` (${why})` : ""}: the chain refuses ` +
    `${them}, so the provider is not paid for work already done. Unless you undo the change within about ` +
    `30 minutes, each one ${STRAND_CONSEQUENCE} They usually settle within a minute, so waiting avoids this.`
  );
}

/**
 * The acknowledgement on a signing screen whose change strands payments
 * still being settled: the count, the amount and the true effect in plain
 * words (the chain refuses them and, unless the change is undone in time,
 * they become payments the buyer owes, which pauses paid calls), and the way
 * to avoid it.
 */
export function strandAcknowledgement(unsettled: UnsettledVouchers | null | undefined): string | null {
  const line = unsettledLine(unsettled);
  if (!line || !unsettled) return null;
  const one = unsettled.count === 1;
  const value = toDecimal(unsettled.amount);
  const amount = formatMoney(unsettled.amount, { decimals: !value.isZero() && value.lt("0.01") ? 4 : 2 });
  return (
    `${line.charAt(0).toUpperCase()}${line.slice(1)} would no longer fit. I accept that the chain then refuses ` +
    `${one ? "it" : "them"} and, unless I undo this change within about 30 minutes, the ${amount} ` +
    `becomes a payment I owe: my paid calls pause until I sign ${one ? "it" : "them"} again (Settle in the banner). ` +
    `Free calls keep working. (Waiting about a minute for ${one ? "it" : "them"} to settle avoids this.)`
  );
}

/** True for the backend's refusal of a change that strands payments still being settled. */
export function isUnsettledRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === UNSETTLED_AT_RISK_CODE;
}

/**
 * True when an edit form says what it was seeded with (the retest gap in
 * BUG-D1-04): signing it would re-grant the standing caps with an expiry a few
 * seconds later, a signature for nothing. Amounts compare as numbers ("0.50"
 * is "0.5"); a field that is not a number is a change, left to validation.
 */
export function editIsUnchanged(
  seeded: DelegationFormInput | null,
  form: DelegationFormInput | null,
  { expired = false }: { expired?: boolean } = {},
): boolean {
  // An expired grant signs nothing today: re-activating it with the same caps
  // is a change (review finding 11).
  if (expired) return false;
  if (!seeded || !form) return false;
  const same = (a: string, b: string) => {
    try {
      return new Decimal(a.trim()).eq(new Decimal(b.trim()));
    } catch {
      return a.trim() === b.trim();
    }
  };
  const keep = form.keepExpiry === true;
  return (
    same(seeded.maxVoucherAmount, form.maxVoucherAmount) &&
    same(seeded.maxPerWindow, form.maxPerWindow) &&
    keep === (seeded.keepExpiry === true) &&
    // A kept expiry is the grant's own, whatever the days field says.
    (keep || same(seeded.validDays, form.validDays))
  );
}

/**
 * The "wait for them to settle" state (review finding 9), as a pure step run
 * on every read of the figures.
 *
 * - After a refusal (`refusedAt`), a read answered before it proves nothing —
 *   it is the very figure the backend just contradicted — so only a read
 *   answered AFTER the refusal can end it.
 * - The wait ends when the figures no longer strand anything (`strands`
 *   false), not only at zero: a payment that still fits is no reason to wait.
 * - It gives up after {@link UNSETTLED_WAIT_MAX_MS} (`stalled`): an agent that
 *   keeps paying keeps the count up.
 */
export interface SettleWaitState {
  waiting: boolean;
  startedAt: number | null;
  /** The person waited, or was refused, and a later read shows nothing left at risk. */
  settled: boolean;
  /** When the backend last refused for payments still being settled. */
  refusedAt: number | null;
  /** The wait ran out with payments still at risk. */
  stalled: boolean;
}

export const SETTLE_WAIT_IDLE: SettleWaitState = {
  waiting: false,
  startedAt: null,
  settled: false,
  refusedAt: null,
  stalled: false,
};

export interface SettleRead {
  /** How many are still being settled; undefined until a read has answered. */
  count: number | undefined;
  /** The change on the screen would strand them, by these figures. */
  strands: boolean;
  /** When this read was answered (epoch ms; react-query's `dataUpdatedAt`). */
  readAt: number;
}

export function settleWaitAfterRead(
  state: SettleWaitState,
  read: SettleRead,
  nowMs: number,
  maxWaitMs: number = UNSETTLED_WAIT_MAX_MS,
): SettleWaitState {
  const active = state.waiting || state.refusedAt !== null;
  if (!active) return state;
  const fresh = state.refusedAt === null || read.readAt > state.refusedAt;
  if (fresh && read.count !== undefined && (read.count === 0 || !read.strands)) {
    return { ...SETTLE_WAIT_IDLE, settled: true };
  }
  if (state.waiting && state.startedAt !== null && nowMs - state.startedAt >= maxWaitMs) {
    return { ...state, waiting: false, startedAt: null, stalled: true };
  }
  return state;
}

/** What the screen says when the wait ran out. */
export const SETTLE_STALLED_TEXT =
  "Your agent is still paying, so new payments keep arriving under the current limits. " +
  "Pause the agent and wait again, or sign anyway.";

/**
 * The grant a sheet shows and checks against (BUG-D1-08, review finding 10):
 * only a read of the list answered AFTER the sheet opened counts — the page's
 * list can predate a payment made since. Until it arrives the grant the sheet
 * opened with stands, but the sheet is not `ready` to sign (unless the read
 * failed: the backend still refuses at intent build). A delegate the fresh
 * list no longer has is `gone` (revoked or replaced elsewhere).
 */
export function liveDelegation(args: {
  opened: EscrowDelegate | null;
  delegate: string;
  list: readonly EscrowDelegate[] | undefined;
  /** When the list was answered (`dataUpdatedAt`). */
  readAt: number;
  /** The `dataUpdatedAt` the cache held when the sheet opened: a read must be later. */
  openedAt: number;
  failed: boolean;
}): { live: EscrowDelegate | null; ready: boolean; gone: boolean } {
  const fresh = args.list !== undefined && args.readAt > args.openedAt;
  if (!fresh) return { live: args.opened, ready: args.failed, gone: false };
  const found = findDelegation(args.list, args.delegate);
  return found ? { live: found, ready: true, gone: false } : { live: null, ready: true, gone: true };
}

/** Why a signed request held back for a re-submit can no longer be submitted. */
export type HeldStale = "deadline" | "nonce";

/** Seconds before its deadline that a held request is treated as expired: the relay needs time. */
export const HELD_DEADLINE_MARGIN_SECONDS = 30;

/**
 * Whether a signed request held for a re-submit (review finding 8) is stale:
 * its `deadline` (chain clock) is within {@link HELD_DEADLINE_MARGIN_SECONDS},
 * or the escrow's `authNonce` has moved past the one it was signed at (another
 * revoke or limits change landed). `currentNonce` is the nonce a fresh request
 * would be built at, when known.
 */
export function heldIsStale(
  held: Record<string, unknown>,
  nowSeconds: number,
  currentNonce?: string | null,
): HeldStale | null {
  const deadline = Number(held.deadline);
  if (!Number.isFinite(deadline) || deadline - nowSeconds <= HELD_DEADLINE_MARGIN_SECONDS) {
    return "deadline";
  }
  if (currentNonce !== undefined && currentNonce !== null && String(held.nonce) !== currentNonce) {
    return "nonce";
  }
  return null;
}

/** What the sheet says when it had to drop the signed request and sign again. */
export function heldStaleText(reason: HeldStale): string {
  return reason === "deadline"
    ? "The change you signed has expired (a signature is valid for 5 minutes), so your wallet will ask you to sign it again."
    : "Another change to your escrow landed since you signed, so that signature can no longer be used. Your wallet will ask you to sign again.";
}
