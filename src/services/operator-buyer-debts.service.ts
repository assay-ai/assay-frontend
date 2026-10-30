import { toTwoPersonAnswer, type TwoPersonAnswer } from "@/features/operator/two-person";
import type { CursorPage } from "@/interfaces/api";
import type { ApprovalQueued } from "@/interfaces/operator";

import { operatorApi } from "./operator-api";

/**
 * Open buyer debts across every organization, and their bulk void (`M-1`):
 * `operator-buyer-debts.controller.ts`.
 *
 *   GET  /operator/buyer-debts        TRE, ADJL; a cursor page plus the
 *                                     totals of everything the filters match
 *   POST /operator/buyer-debts/void   TRE or ADJL; always 202, approved by a
 *                                     different TRE or ADJL in the approvals inbox
 *
 * A buyer debt is a served call whose voucher lapsed: the buyer owes it and
 * its paid calls are refused until it is settled. A void releases the hold,
 * the buyer is not charged, and the provider is NOT paid for that call. It
 * cannot be undone.
 *
 * Errors on void: 400 `OPERATOR_DEBT_VOID_INVALID` (`error.context.intentIds`
 * names the ids that are not open debts now; without it, the ids span more
 * than one asset, or there are more than 100), 403 `OPERATOR_ROLE_REQUIRED` / `OPERATOR_AUTHORITY_EXCEEDED`.
 */

export type BuyerDebtSort = "lapsedAt" | "createdAt";

export interface ListBuyerDebtsQuery {
  cursor?: string;
  limit?: number;
  sort?: BuyerDebtSort;
  order?: "asc" | "desc";
  /** Lapse-time range, ISO. */
  from?: string;
  to?: string;
  chainId?: string;
  assetId?: string;
  payerAccount?: string;
  buyerOrganizationId?: string;
  providerId?: string;
  /** The refusal the voucher lapsed on, exactly (`VoucherExpired`). */
  lastError?: string;
  suggestedOnly?: boolean;
}

/** One open buyer debt. */
export interface OperatorBuyerDebt {
  /** The payment intent id: what a void names. */
  intentId: string;
  buyerOrganizationId: string;
  /** CAIP-10. */
  payerAccount: string;
  providerId: string | null;
  /** CAIP-10, the provider's payee. */
  providerAccount: string | null;
  /** CAIP-2. */
  chainId: string;
  /** CAIP-19. */
  assetId: string;
  decimals: number;
  /** Atomic units, a decimal string. */
  amount: string;
  voucherSeq: string | null;
  createdAt: string;
  /** When the call became buyer debt. */
  lapsedAt: string;
  lastError: string | null;
  /** Written off already (30 days unsettled): the hold is released, the payer is still refused. */
  writtenOff: boolean;
  /** Informational only: the recorded cause suggests the platform failed to redeem. A person decides. */
  suggestedPlatformCause: boolean;
}

/** Count and amount of one asset's debts in the filtered list. Amounts of different assets are never added. */
export interface BuyerDebtAssetTotal {
  assetId: string;
  decimals: number;
  count: number;
  amount: string;
}

export interface BuyerDebtPage extends CursorPage<OperatorBuyerDebt> {
  totals: { count: number; byAsset: BuyerDebtAssetTotal[] };
}

export interface RequestBuyerDebtVoidBody {
  /** 1 to 100 open debts of one asset. */
  intentIds: string[];
  /** 10 to 2048 characters: why the platform, not the buyer, caused these debts. */
  reason: string;
  ticketRef?: string;
}

/** Why a debt was not voided; `NOT_ATTEMPTED` when the run stopped before reaching it. */
export type BuyerDebtSkipReason = "NOT_A_DEBT" | "SEQ_USED_ON_CHAIN" | "CHAIN_UNREADABLE" | "CHANGED_UNDERNEATH" | "NOT_ATTEMPTED";

/** What an approved bulk void did: the `result` of `POST /operator/approvals/:id/approve`. */
export interface BuyerDebtVoidResult {
  approvalId: string;
  assetId: string;
  decimals: number;
  requestedCount: number;
  requestedAmount: string;
  voidedCount: number;
  voidedAmount: string;
  items: { intentId: string; result: "VOIDED" | "SKIPPED"; skipReason: BuyerDebtSkipReason | null }[];
}

/**
 * The outcome kept on the approval (`result` of `GET /operator/approvals/:id`
 * and the lists): the approve answer plus the skipped side. `complete: false`
 * is a partial run; the ids it never reached are `NOT_ATTEMPTED`.
 */
export interface BuyerDebtVoidRecord extends BuyerDebtVoidResult {
  skippedCount: number;
  skippedAmount: string;
  complete: boolean;
  recordedAt: string | null;
}

/** `GET /operator/buyer-debts`. */
export function listOperatorBuyerDebts(query: ListBuyerDebtsQuery = {}): Promise<BuyerDebtPage> {
  return operatorApi.get<BuyerDebtPage>("/operator/buyer-debts", query as Record<string, unknown>);
}

/** `POST /operator/buyer-debts/void` — `M-1`, always queued for a second operator. */
export async function requestBuyerDebtVoid(body: RequestBuyerDebtVoidBody): Promise<TwoPersonAnswer<never>> {
  return toTwoPersonAnswer<never>(await operatorApi.postWithStatus<ApprovalQueued>("/operator/buyer-debts/void", body));
}

/**
 * The open debts among these ids, read off the list of their asset page by
 * page until every id is found or `maxPages` are read (the list has no id
 * filter). `searchedAll` is false when it stopped at `maxPages` with ids
 * still unseen; with it true, an unseen id is no longer an open debt.
 */
export async function findOpenBuyerDebts(
  intentIds: readonly string[],
  assetId: string,
  maxPages: number,
): Promise<{ rows: OperatorBuyerDebt[]; searchedAll: boolean }> {
  const wanted = new Set(intentIds);
  const rows: OperatorBuyerDebt[] = [];
  let cursor: string | undefined;
  for (let read = 0; read < maxPages; read += 1) {
    const page = await listOperatorBuyerDebts({ assetId, cursor, limit: 100 });
    for (const row of page.items) if (wanted.has(row.intentId)) rows.push(row);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    if (rows.length >= wanted.size || !cursor) return { rows, searchedAll: true };
  }
  return { rows, searchedAll: false };
}
