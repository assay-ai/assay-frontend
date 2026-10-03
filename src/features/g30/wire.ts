import type { Money } from "@/interfaces";

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
  /** listedPrice − chargedPrice, computed server-side. */
  withheld: Money;
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
}

/* ------------------------------------------------------------------- summary */

export interface SummaryFigures {
  calls: number;
  refundedCalls: number;
  listedTotal: Money;
  chargedTotal: Money;
  withheldTotal: Money;
  failRate: number | null;
}

/** The previous period, plus the deltas the server already computed for us. */
export interface SummaryComparison extends SummaryFigures {
  deltaCalls: number;
  deltaListedTotal: Money;
  deltaChargedTotal: Money;
  deltaWithheldTotal: Money;
}

export interface SummaryGroup extends SummaryFigures {
  /** Tool id, provider id or a `YYYY-MM-DD` day, depending on `groupBy`. */
  key: string;
  comparison: SummaryComparison | null;
}

export interface ReceiptsSummary {
  groups: SummaryGroup[];
  totals: SummaryFigures;
  asset: string;
}
