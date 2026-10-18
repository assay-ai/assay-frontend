import type { CursorPage, Money } from "@/interfaces/api";

import { api } from "./api";

/**
 * Buyer disputes over paid calls ("Report a bad result", backlog G3.B1).
 * Shapes follow the backend's `dispute/dto/call-dispute.dto.ts`.
 *
 *   Buyer     POST /call-disputes · GET /call-disputes · GET /call-disputes/:id
 *             POST /call-disputes/:id/withdraw
 *   Provider  GET /providers/me/call-disputes · GET …/:id · POST …/:id/respond
 *
 * The provider never sees the buyer's organization. Errors on filing:
 * `DISPUTE_CALL_NOT_DISPUTABLE`, `DISPUTE_FILING_WINDOW_CLOSED`,
 * `DISPUTE_ALREADY_OPEN` (409), `DISPUTE_RATE_LIMITED` (429); on a reply
 * `DISPUTE_ALREADY_RESPONDED` (409).
 */

export type CallDisputeState = "OPEN" | "UPHELD" | "REJECTED" | "WITHDRAWN";
export type CallDisputeReason = "WRONG_DATA" | "EMPTY_OR_GARBAGE" | "WRONG_FORMAT" | "TOO_SLOW" | "OTHER";
/**
 * REFUNDED: the buyer is not charged. NOT_CHARGED: it never was.
 * NOT_REFUNDABLE: filed after the hold and the provider was paid.
 * PENDING: decided, the refund is still landing.
 */
export type RefundState = "PENDING" | "REFUNDED" | "NOT_CHARGED" | "NOT_REFUNDABLE";

export interface CallDispute {
  id: string;
  state: CallDisputeState | string;
  reason: CallDisputeReason | string;
  /** The backend's label: "Wrong data". */
  reasonLabel: string;
  note: string | null;
  intentId: string;
  verdictId: string | null;
  toolId: string | null;
  bindingId: string | null;
  providerId: string;
  /** What the call cost. */
  amount: Money | null;
  providerResponse: string | null;
  providerRespondedAt: string | null;
  resolvedAt: string | null;
  /** The operator's reasoning, verbatim. */
  resolutionNote: string | null;
  refundSource: "UNCOLLECTED_EARNINGS" | "NONE" | string | null;
  refundState: RefundState | string | null;
  refundAmount: Money | null;
  restoredAmount: Money | null;
  /** The provider may still reply once. */
  canRespond: boolean;
  /** Filed while the payment was held: an upheld decision refunds it in full. */
  refundGuaranteed: boolean;
  /** The sentence to show the buyer about `refundGuaranteed`. */
  refundNotice: string;
  createdAt: string;
  updatedAt: string;
}

/** The call as it was when the dispute was filed. */
export interface CallDisputeEvidence {
  capturedAt?: string;
  call?: { status?: string; rail?: string; callClass?: string; amount?: string; createdAt?: string } | null;
  verdict?: { status?: string; reason?: string | null; reasonCode?: string | null; evaluatedAt?: string | null; settledAt?: string | null } | null;
  request?: unknown;
  response?: unknown;
}

export interface CallDisputeDetail extends CallDispute {
  evidence: CallDisputeEvidence & Record<string, unknown>;
}

export interface FileCallDisputeBody {
  subjectType: "PAYMENT_INTENT" | "VERDICT";
  subjectId: string;
  reason: CallDisputeReason;
  note?: string;
}

export interface ListCallDisputesQuery {
  state?: readonly CallDisputeState[];
  intentId?: string;
  limit?: number;
  cursor?: string;
}

function listParams(query: ListCallDisputesQuery): Record<string, unknown> {
  const params: Record<string, unknown> = { limit: query.limit ?? 25 };
  if (query.state && query.state.length > 0) params.state = query.state.join(",");
  if (query.intentId) params.intentId = query.intentId;
  if (query.cursor) params.cursor = query.cursor;
  return params;
}

/* ------------------------------------------------------------------ buyer */

export function fileCallDispute(body: FileCallDisputeBody): Promise<CallDisputeDetail> {
  return api.post<CallDisputeDetail>("/call-disputes", body);
}

export function listCallDisputes(query: ListCallDisputesQuery = {}): Promise<CursorPage<CallDispute>> {
  return api.get<CursorPage<CallDispute>>("/call-disputes", listParams(query));
}

export function getCallDispute(id: string): Promise<CallDisputeDetail> {
  return api.get<CallDisputeDetail>(`/call-disputes/${encodeURIComponent(id)}`);
}

export function withdrawCallDispute(id: string): Promise<CallDispute> {
  return api.post<CallDispute>(`/call-disputes/${encodeURIComponent(id)}/withdraw`);
}

/* --------------------------------------------------------------- provider */

export function listProviderCallDisputes(query: ListCallDisputesQuery = {}): Promise<CursorPage<CallDispute>> {
  return api.get<CursorPage<CallDispute>>("/providers/me/call-disputes", listParams(query));
}

export function getProviderCallDispute(id: string): Promise<CallDisputeDetail> {
  return api.get<CallDisputeDetail>(`/providers/me/call-disputes/${encodeURIComponent(id)}`);
}

/** The provider's one reply, before the decision. */
export function respondToCallDispute(id: string, response: string): Promise<CallDisputeDetail> {
  return api.post<CallDisputeDetail>(`/providers/me/call-disputes/${encodeURIComponent(id)}/respond`, { response });
}
