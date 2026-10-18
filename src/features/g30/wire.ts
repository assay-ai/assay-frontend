import type { CallDebt, Money } from "@/interfaces";

/**
 * A local view of two wire shapes that `@/services` returns as `unknown`.
 *
 * `getReceipt()` and `getReceiptsSummary()` in `receipts.service.ts` are typed
 * `Promise<unknown>`; that file is shared, so
 * the shapes are transcribed here from the running API's own OpenAPI document
 * (`GetReceiptResponseDto`, `GetReceiptsSummaryResponseDto`) and verified
 * against live responses. When the service grows real return types, delete
 * these and import them instead.
 */

/* ------------------------------------------------------------------ receipts */

/** Wire values for `ReceiptStageDto.status` — EIGHT, not the design's four. */
export type WireStageStatus =
  | "PASSED"
  | "FAILED"
  | "NOT_REACHED"
  | "NOT_APPLICABLE"
  | "NOT_IMPLEMENTED"
  | "MISAPPLIED"
  | "SKIPPED"
  | "UNAVAILABLE";

export type WireStageName = "SCHEMA" | "DETERMINISTIC_RULES" | "CROSS_CHECK" | "SEMANTIC";

export interface ReceiptStage {
  stage: WireStageName;
  status: WireStageStatus;
  /** The API's own one-wording-every-surface label, e.g. "could not run". */
  label: string;
  note?: string | null;
  /** "The only status that may ever be rendered as a tick" — the API's words. */
  passed?: boolean;
  code?: string | null;
  detail?: string | null;
  score?: number | null;
}

export interface ReceiptVerdict {
  status?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  score?: number | null;
}

export interface ReceiptSampling {
  rate?: number | null;
  sampled?: boolean | null;
  /** The published sentence, verbatim — "1 in 125 calls at this price". */
  display?: string | null;
}

export interface ReceiptPolicy {
  policyId?: string | null;
  policyVersion?: number | null;
  decisionPolicyId?: string | null;
  decisionPolicyVersion?: number | null;
  lifecycle?: string | null;
}

export interface Receipt {
  intentId: string;
  toolId: string;
  providerId: string | null;
  /** The response class: DATA_RESULT, EMPTY_RESULT, SYSTEM_ERROR, … */
  classification: string | null;
  /** One of PaymentIntentStatus. */
  status: string;
  listedPrice: Money;
  chargedPrice: Money;
  /**
   * What the refund guarantee kept back (REFUNDED / VOIDED / EXPIRED with a
   * hold). NOT `listedPrice − chargedPrice`: a SETTLED call the provider
   * forfeited, or whose debt was written off, has both charged and withheld
   * zero.
   */
  withheld: Money;
  /**
   * SETTLED, but the provider caused the payment to fail and forfeited it: not
   * charged, nobody paid. Optional: older backends do not send it.
   */
  forfeited?: boolean;
  /**
   * Buyer debt. `OUTSTANDING`: the payment could not be collected; the price
   * stays held and is charged once the payer signs a replacement voucher — paid
   * calls are refused until then. `WRITTEN_OFF`: never settled; written off for
   * the provider (not paid), but the buyer still owes it: paid calls stay
   * refused until it is signed, and the summary counts it under owed.
   * `VOIDED`: the call failed verification after it had become debt; not
   * charged, provider not paid.
   */
  debt?: CallDebt | null;
  /** The recorded cause behind `forfeited` or `debt`, e.g. `uncollected:DelegateIsRevoked`. */
  chargeNote?: string | null;
  verdict: ReceiptVerdict;
  stages: ReceiptStage[];
  policy: ReceiptPolicy;
  sampling: ReceiptSampling;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  holdReleasedAt?: string | null;
  evaluatedAt?: string | null;
  settledAt?: string | null;
  /** When the payment may be collected (the dispute hold ends). Null when the call has no hold. */
  collectableAt?: string | null;
  /** Report before this and an upheld dispute refunds the call in full; after it, a quality signal. */
  disputeWindowEndsAt?: string | null;
  /** "Report a bad result" is accepted until then; null when the call cannot be reported. */
  disputeFilingClosesAt?: string | null;
}

/* ------------------------------------------------------------------- summary */

export interface SummaryFigures {
  calls: number;
  refundedCalls: number;
  listedTotal: Money;
  /** Served and collected (or being collected). Open or written-off buyer debt is in `owedTotal`. */
  chargedTotal: Money;
  /** The guarantee's withheld figure — part of `notChargedTotal`, not all of it. */
  withheldTotal: Money;
  /**
   * Not charged: refunded, voided and expired calls, and served calls never
   * collected and not owed (forfeited, voided debt). A written-off debt is
   * owed, not here.
   * `listedTotal = chargedTotal + notChargedTotal + owedTotal + inProgressTotal`.
   */
  notChargedTotal: Money;
  notChargedCalls: number;
  /**
   * Buyer debt, open or written off: served, payment not collected yet, still
   * owed by the buyer — neither charged nor not charged.
   */
  owedTotal: Money;
  owedCalls: number;
  /** Calls not finished yet, at their listed price. */
  inProgressTotal: Money;
  inProgressCalls: number;
  failRate: number | null;
}

/** The previous period, plus the deltas the server already computed for us. */
export interface SummaryComparison extends SummaryFigures {
  deltaCalls: number;
  deltaListedTotal: Money;
  deltaChargedTotal: Money;
  deltaWithheldTotal: Money;
  deltaNotChargedTotal: Money;
  deltaOwedTotal: Money;
}

export interface SummaryGroup extends SummaryFigures {
  /** Tool id, provider id, agent id or a `YYYY-MM-DD` day, depending on `groupBy`. */
  key: string;
  comparison: SummaryComparison | null;
}

export interface ReceiptsSummary {
  groups: SummaryGroup[];
  totals: SummaryFigures;
  asset: string;
}
