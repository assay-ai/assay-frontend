import { toTwoPersonAnswer, type TwoPersonAnswer } from "@/features/operator/two-person";
import type { CursorPage, Money } from "@/interfaces/api";
import type { ApprovalQueued } from "@/interfaces/operator";

import type { CallDispute, CallDisputeEvidence, CallDisputeState, RefundState } from "./call-disputes.service";
import { operatorApi } from "./operator-api";

/**
 * The operator's queue of buyer disputes over paid calls (G3.B1), across
 * tenants: `operator-call-disputes.controller.ts`.
 *
 *   GET  /operator/call-disputes?state=OPEN&flaggedOnly=
 *   GET  /operator/call-disputes/:id
 *   POST /operator/call-disputes/:id/decide     S-14; an upheld decision at or above the
 *                                               threshold answers 202 (a second operator)
 *   GET  /operator/call-disputes/buyers/:buyerId
 *
 * Errors on decide: `DISPUTE_NOT_DECIDABLE` (decided or withdrawn),
 * `DISPUTE_COLLECTION_IN_PROGRESS` (the money is moving; try in a minute).
 */

export interface BuyerDisputeHistory {
  filedLastDay: number;
  upheldLast30Days: number;
  rejectedLast30Days: number;
  /** Mostly rejected recently: the tighter filing limit applies. */
  flagged: boolean;
  dailyLimit: number;
}

export interface OperatorCallDisputeRow extends CallDispute {
  buyerOrganizationId: string;
  buyerHistory: BuyerDisputeHistory;
  /** Upholding needs a second operator (amount at or above the threshold). */
  needsSecondOperator: boolean;
}

export interface OperatorCallDisputeIntent {
  status: string;
  rail: string;
  callClass: string;
  price: Money;
  /** NORMAL, DEBT_OUTSTANDING, WRITTEN_OFF, … */
  collectionState: string;
  /** What an upheld decision would do now: RELEASE_HELD, VOID_DEBT, NOT_CHARGED, COLLECTED, … */
  refundPlan: string;
}

export interface OperatorCallDisputeDetail extends OperatorCallDisputeRow {
  evidence: CallDisputeEvidence & Record<string, unknown>;
  intent: OperatorCallDisputeIntent | null;
  resolvedBy: string | null;
  secondedBy: string | null;
  history: { code: string; action: string; actorOperatorId: string; approverOperatorId: string | null; createdAt: string }[];
}

export interface DecideCallDisputeBody {
  decision: "UPHOLD" | "REJECT";
  /** 10–2048 characters, shown to the buyer and the provider verbatim. */
  note: string;
  ticketRef?: string;
}

export interface ListOperatorCallDisputesQuery {
  state?: readonly CallDisputeState[];
  refundState?: RefundState;
  flaggedOnly?: boolean;
  /** By filing time, lower case on the wire. The queue reads oldest first (asc): the SLA runs from the filing. Default desc. */
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

export function listOperatorCallDisputes(query: ListOperatorCallDisputesQuery = {}): Promise<CursorPage<OperatorCallDisputeRow>> {
  const params: Record<string, unknown> = { limit: query.limit ?? 50 };
  if (query.state && query.state.length > 0) params.state = query.state.join(",");
  if (query.refundState) params.refundState = query.refundState;
  if (query.flaggedOnly) params.flaggedOnly = true;
  if (query.order) params.order = query.order;
  if (query.cursor) params.cursor = query.cursor;
  return operatorApi.get<CursorPage<OperatorCallDisputeRow>>("/operator/call-disputes", params);
}

export function getOperatorCallDispute(id: string): Promise<OperatorCallDisputeDetail> {
  return operatorApi.get<OperatorCallDisputeDetail>(`/operator/call-disputes/${encodeURIComponent(id)}`);
}

export async function decideOperatorCallDispute(
  id: string,
  body: DecideCallDisputeBody,
): Promise<TwoPersonAnswer<OperatorCallDisputeDetail>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<OperatorCallDisputeDetail | ApprovalQueued>(`/operator/call-disputes/${encodeURIComponent(id)}/decide`, body),
  );
}
