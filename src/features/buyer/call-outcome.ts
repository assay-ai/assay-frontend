import type { Money } from "@/interfaces";
import { notCharged, toDecimal } from "@/utils/money";

/**
 * What happened to one call's money, in the four words the buyer screens use
 * (Overview, Calls, receipts): Charged · Not charged · Free · Checking.
 *
 * From `GET /tool-calls`: `status` is the payment intent's (`SETTLED` charged
 * the hold; `REFUNDED`, `VOIDED` and `EXPIRED` released it; the rest are still
 * in flight), `price` is the listed price and `charged` what was paid.
 */

export type CallOutcome = "charged" | "not-charged" | "free" | "checking";

export const IN_FLIGHT_STATUSES = ["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"] as const;
export const NOT_CHARGED_STATUSES = ["REFUNDED", "VOIDED", "EXPIRED"] as const;
export const CHARGED_STATUSES = ["SETTLED"] as const;

export function callOutcome(call: { status: string; price: Money; charged: Money }): CallOutcome {
  if (toDecimal(call.price).isZero()) return "free";
  if ((IN_FLIGHT_STATUSES as readonly string[]).includes(call.status)) return "checking";
  if (toDecimal(call.charged).gt(0) && !toDecimal(notCharged(call.price, call.charged)).gt(0)) return "charged";
  if ((NOT_CHARGED_STATUSES as readonly string[]).includes(call.status)) return "not-charged";
  return toDecimal(call.charged).gt(0) ? "charged" : "not-charged";
}

/** The Calls tab's status chips. */
export type CallsFilter = "all" | "charged" | "not-charged" | "free";

export const CALLS_FILTERS: { value: CallsFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "charged", label: "Charged" },
  { value: "not-charged", label: "Not charged" },
  { value: "free", label: "Free" },
];

export function parseCallsFilter(raw: string | null | undefined): CallsFilter {
  return CALLS_FILTERS.some((f) => f.value === raw) ? (raw as CallsFilter) : "all";
}

/** The `status` the API filters on for a chip; `undefined` for All and Free (Free is filtered here). */
export function statusesFor(filter: CallsFilter): string[] | undefined {
  if (filter === "charged") return [...CHARGED_STATUSES];
  if (filter === "not-charged") return [...NOT_CHARGED_STATUSES];
  return undefined;
}

export function matchesFilter(call: { status: string; price: Money; charged: Money }, filter: CallsFilter): boolean {
  if (filter === "all") return true;
  return callOutcome(call) === filter;
}
