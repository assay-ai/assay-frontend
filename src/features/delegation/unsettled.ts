import Decimal from "decimal.js";

import type { DelegationFormInput } from "@/features/delegation/delegation-form";
import type { Money, UnsettledVouchers } from "@/interfaces";
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
): boolean {
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
