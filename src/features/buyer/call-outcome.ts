import type { CallDebt, Money } from "@/interfaces";
import { notCharged, toDecimal } from "@/utils/money";

/**
 * What happened to one call's money, in the four words the buyer screens use
 * (Overview, Calls, receipts): Charged · Not charged · Free · Checking.
 *
 * From `GET /tool-calls`: `status` is the payment intent's (`SETTLED` charged
 * the hold; `REFUNDED`, `VOIDED` and `EXPIRED` released it; the rest are still
 * in flight), `price` is the listed price and `charged` what was paid.
 *
 * A fifth word, Owed, is buyer debt (`debt` OUTSTANDING or WRITTEN_OFF): the
 * call was served but its payment was not collected yet, so it is neither
 * charged nor let off, and paid calls stay paused until it is settled.
 */

export type CallOutcome = "charged" | "not-charged" | "free" | "checking" | "owed";

export const IN_FLIGHT_STATUSES = ["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"] as const;
export const NOT_CHARGED_STATUSES = ["REFUNDED", "VOIDED", "EXPIRED"] as const;
export const CHARGED_STATUSES = ["SETTLED"] as const;

export function callOutcome(call: {
  status: string;
  price: Money;
  charged: Money;
  debt?: CallDebt | null;
}): CallOutcome {
  if (toDecimal(call.price).isZero()) return "free";
  if ((IN_FLIGHT_STATUSES as readonly string[]).includes(call.status)) return "checking";
  if (call.debt === "OUTSTANDING" || call.debt === "WRITTEN_OFF") return "owed";
  if (toDecimal(call.charged).gt(0) && !toDecimal(notCharged(call.price, call.charged)).gt(0)) return "charged";
  if ((NOT_CHARGED_STATUSES as readonly string[]).includes(call.status)) return "not-charged";
  return toDecimal(call.charged).gt(0) ? "charged" : "not-charged";
}

/**
 * The Calls tab's status chips. `refundable` ("Still refundable") is the
 * calls a report filed now would refund in full: the backend decides it with
 * the receipt's own predicate (`GET /tool-calls?refundable=true`), never a
 * clock rule here.
 */
export type CallsFilter = "all" | "charged" | "not-charged" | "owed" | "free" | "refundable";

export const CALLS_FILTERS: { value: CallsFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "charged", label: "Charged" },
  { value: "refundable", label: "Still refundable" },
  { value: "not-charged", label: "Not charged" },
  { value: "owed", label: "Owed" },
  { value: "free", label: "Free" },
];

export function parseCallsFilter(raw: string | null | undefined): CallsFilter {
  return CALLS_FILTERS.some((f) => f.value === raw) ? (raw as CallsFilter) : "all";
}

/**
 * The `status` the API filters on for a chip; `undefined` for All and Free.
 * The API has no debt or forfeit filter, so every chip is also filtered here
 * on `callOutcome`.
 */
export function statusesFor(filter: CallsFilter): string[] | undefined {
  if (filter === "charged") return [...CHARGED_STATUSES];
  // A forfeited call or a voided debt is not charged but stays SETTLED, so the
  // chip asks for SETTLED too and keeps only the not-charged ones here.
  if (filter === "not-charged") return [...NOT_CHARGED_STATUSES, ...CHARGED_STATUSES];
  // Buyer debt (open or written off) is a SETTLED intent.
  if (filter === "owed") return [...CHARGED_STATUSES];
  if (filter === "refundable") return [...CHARGED_STATUSES];
  return undefined;
}

/** Whether a chip asks the API for the refundable calls only (`refundable=true`). */
export function refundableOnly(filter: CallsFilter): true | undefined {
  return filter === "refundable" ? true : undefined;
}

export function matchesFilter(
  call: { status: string; price: Money; charged: Money; debt?: CallDebt | null },
  filter: CallsFilter): boolean {
  if (filter === "all") return true;
  // The API already kept only the refundable ones; nothing to re-derive here.
  if (filter === "refundable") return true;
  return callOutcome(call) === filter;
}
