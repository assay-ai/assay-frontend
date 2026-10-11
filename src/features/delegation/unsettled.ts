import Decimal from "decimal.js";

import { type DelegationFormInput, findDelegation } from "@/features/delegation/delegation-form";
import type { EscrowDelegate, Money, UnsettledVouchers } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { formatMoney } from "@/utils/money";

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
 * Why the chain would refuse a payment still being settled once `next` stands.
 * Only a cap that goes DOWN counts: a cap that stays or rises cannot strand a
 * payment that fits today. Empty when nothing is unsettled.
 */
export function strandReasons(
  unsettled: UnsettledVouchers | null | undefined,
  current: AtomicCaps,
  next: AtomicCaps | "revoke",
): StrandReason[] {
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

/** "2 payments (0.600000 USDG) still being settled", or null when there are none. */
export function unsettledLine(
  unsettled: UnsettledVouchers | null | undefined,
  unit: string,
): string | null {
  if (!unsettled || unsettled.count === 0) return null;
  const amount = `${formatMoney(unsettled.amount, {
    decimals: unsettled.amount.decimals,
    symbol: "",
  })} ${unit}`.trim();
  return `${unsettled.count} payment${unsettled.count === 1 ? "" : "s"} (${amount}) still being settled`;
}

const REASON_TEXT: Record<StrandReason, string> = {
  maxVoucherAmount: "one of them is larger than the new per-payment limit",
  maxPerWindow: "together they no longer fit the new 24-hour limit",
  validUntil: "the new expiry comes before they can be redeemed",
  revoked: "a revoked key's payments cannot be redeemed",
};

/** What the screen says about a change that strands them. */
export function strandWarning(reasons: readonly StrandReason[], count: number): string {
  const them = count === 1 ? "it" : "them";
  const why = reasons.map((r) => REASON_TEXT[r]).join("; ");
  return (
    `This change would leave ${them} unredeemable${why ? ` (${why})` : ""}: the chain refuses ` +
    `${them} and the provider is not paid for work already done. They usually settle within a ` +
    `minute.`
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
  return (
    same(seeded.maxVoucherAmount, form.maxVoucherAmount) &&
    same(seeded.maxPerWindow, form.maxPerWindow) &&
    same(seeded.validDays, form.validDays)
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
