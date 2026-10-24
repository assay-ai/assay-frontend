import type { CallDebt, CursorPage, ListQuery, Money, WireVerdict } from "@/interfaces";

import { api } from "./api";

export interface ToolCall {
  intentId: string;
  toolId: string;
  providerId: string | null;
  status: string;
  price: Money;
  /**
   * What the agent actually paid: zero until SETTLED, and zero for a SETTLED
   * call the provider forfeited or whose debt was written off.
   */
  charged: Money;
  /**
   * What the refund guarantee kept back, the receipt's `withheld`: the listed
   * price of a call that held money and was not charged, else zero. Zero for
   * an EXPIRED call that never held anything (it never ran). Absent on older
   * servers.
   */
  withheld?: Money;
  /**
   * SETTLED, but the provider caused the payment to fail and forfeited it:
   * not charged, nobody paid.
   */
  forfeited: boolean;
  /**
   * Buyer debt: `OUTSTANDING` — the payment could not be collected, the price
   * stays held and the payer must sign a replacement voucher before paid calls
   * work again (also while a signed replacement is being collected);
   * `WRITTEN_OFF` — never settled, not charged, provider not paid, and paid
   * calls stay refused until it is signed; `VOIDED` — the call failed
   * verification after it had become debt: not charged, provider not paid.
   */
  debt: CallDebt | null;
  /**
   * SETTLED, and refunded because the buyer's report of a bad result was
   * upheld (`debt` is `VOIDED`).
   */
  refundedByReport: boolean;
  /** Wider than the OpenAPI enum, and nullable. See @/utils/verdict. */
  verdict: WireVerdict;
  createdAt: string;
  /**
   * Only on `refundable=true`: until when a report filed now is refunded in
   * full (the receipt's `refundableIfReportedUntil`). Null when the payment is
   * not collected yet (its hour starts then).
   */
  refundableIfReportedUntil?: string | null;
}

export interface ListToolCallsQuery extends ListQuery {
  status?: string[];
  toolId?: string;
  providerId?: string;
  verdict?: string[];
  from?: string;
  to?: string;
  search?: string;
  /**
   * Only calls a report filed now would refund in full: the backend's own
   * predicate (the receipt's `refundableIfReportedNow`), never a clock rule.
   */
  refundable?: boolean;
}

/**
 * A served free call (lot 1 B5, BUG-AGT-01): `GET /tool-calls?include=free`
 * lists them beside the paid ones. No intent, no payment status, no money:
 * there is no receipt to open.
 */
export interface FreeToolCall {
  kind: "free";
  intentId: null;
  /** `X-Assay-Call-Id`. */
  callId: string;
  toolId: string | null;
  toolName: string | null;
  providerId: string | null;
  pricingMode: "FREE" | "FREEMIUM" | string;
  verdict: WireVerdict;
  createdAt: string;
}

export function isFreeToolCall(call: ToolCall | FreeToolCall): call is FreeToolCall {
  return (call as FreeToolCall).kind === "free";
}

/**
 * `GET /tool-calls?include=free&kind=free` — the served free calls only, the
 * Calls page's Free chip. One cursor, newest first. An older backend refuses
 * the parameter (400); the caller then falls back to the plain list.
 */
export function listFreeToolCalls(
  query: Pick<ListToolCallsQuery, "limit" | "cursor" | "toolId" | "providerId" | "from" | "to" | "search"> = {},
): Promise<CursorPage<FreeToolCall>> {
  return api.get<CursorPage<FreeToolCall>>("/tool-calls", { ...query, include: "free", kind: "free" } as Record<string, unknown>);
}

/** GET /tool-calls — the recent-calls list on the Overview and the spine of the Spend explorer. */
export function listToolCalls(query: ListToolCallsQuery = {}): Promise<CursorPage<ToolCall>> {
  return api.get<CursorPage<ToolCall>>("/tool-calls", query as Record<string, unknown>);
}

export function getToolCall(intentId: string): Promise<ToolCall> {
  return api.get<ToolCall>(`/tool-calls/${intentId}`);
}
