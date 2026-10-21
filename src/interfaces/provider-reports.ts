/**
 * The four report sub-resources of `providers/me` — traffic, quality,
 * earnings, and the per-call CSV export.
 *
 * Source: assay-backend `src/modules/provider/dto/get-provider-{traffic,quality,
 * earnings,calls-export}.dto.ts`.
 *
 * None of the first three is a cursor list. A bounded window of daily buckets
 * is small enough to return whole, and a client charting it wants every bucket
 * in one response — the same decision `receipts/summary` made on the buyer
 * side. `from`/`to` are **required** on all four, and both are ISO-8601 with
 * `from` inclusive and `to` exclusive.
 */

import type { Money } from "./api";

/** `from`/`to` are required on every report endpoint. */
export interface ProviderReportWindow {
  /** ISO-8601, inclusive lower bound. */
  from: string;
  /** ISO-8601, exclusive upper bound. */
  to: string;
}

// ── Earnings ───────────────────────────────────────────────────────────────

export type ProviderEarningsGroupBy = "day" | "tool";

export interface ProviderEarningsQuery extends ProviderReportWindow {
  groupBy: ProviderEarningsGroupBy;
  /** CAIP-19 asset id. Required if the window spans more than one, else `PROVIDER_MULTIPLE_ASSETS`. */
  asset?: string;
}

/** The per-call export classes a provider reads as "not credited". */
export type NotCreditedClass = "PAID_UNCREDITED" | "SYSTEM_ERROR" | "REQUEST_ERROR";

/** One not-credited reason: its calls and their worth. */
export interface NotCreditedClassFigure {
  class: NotCreditedClass;
  calls: number;
  amount: Money | null;
}

/**
 * One group's figures.
 *
 * `null` money is not zero: when the window matched no rows and no `asset`
 * filter was given there is no asset to denominate a zero in, and an empty
 * CAIP-19 id would be a malformed value wearing the shape of a valid one.
 */
export interface ProviderEarningsFigures {
  calls: number;
  /** Σ provider_amount over SETTLED intents. */
  earned: Money | null;
  /** Σ platform_fee over SETTLED intents. */
  platformFee: Money | null;
  /**
   * Not credited: Σ provider_amount over the calls that earned nothing because
   * of their answer or request (a failed check, an endpoint error, a refused
   * request), held or not. Exactly the sum of `withheldByClass`.
   */
  withheld: Money | null;
  withheldCalls: number;
  /**
   * `withheld` by reason, one row per per-call export class, always all three.
   */
  withheldByClass: NotCreditedClassFigure[];
  /**
   * The three ways a call that PASSED still paid the provider nothing (yet).
   * None of them is in `earned`, and none is ever paid by the platform: a
   * provider is only ever paid out of the buyer's escrow. Optional: older
   * backends do not send them.
   *
   * - `forfeited` — the provider caused the payment to fail (stake below the
   *   minimum, or blocked); the buyer was not charged.
   * - `debtOutstanding` — buyer debt: the payment could not be collected yet,
   *   the price is still held in the buyer's escrow, and it is paid once the
   *   buyer signs a replacement voucher.
   * - `uncollected` — a buyer debt written off after 30 days: not paid, but the
   *   buyer still owes it and the provider is paid if it settles later.
   */
  forfeited?: Money | null;
  forfeitedCalls?: number;
  debtOutstanding?: Money | null;
  debtOutstandingCalls?: number;
  uncollected?: Money | null;
  uncollectedCalls?: number;
}

export interface ProviderEarningsGroup extends ProviderEarningsFigures {
  /** The day (`YYYY-MM-DD`) or the tool id this row groups. */
  key: string;
}

export interface ProviderEarnings {
  groups: ProviderEarningsGroup[];
  totals: ProviderEarningsFigures;
  /** CAIP-19 asset every total is denominated in. `null` when nothing matched. */
  asset: string | null;
}

// ── Per-call CSV export ────────────────────────────────────────────────────

export interface ProviderCallsExportQuery extends ProviderReportWindow {
  /** CAIP-19 asset id — narrows the export to one asset. */
  asset?: string;
}

/**
 * The visible-cap headers this endpoint sets before the first CSV byte:
 * `X-Assay-Export-Row-Count`, `X-Assay-Export-Total-Matching` and
 * `X-Assay-Export-Truncated`.
 *
 * They exist because the export deliberately caps its own output and the
 * no-silent-caps rule cannot ride in a JSON envelope here — the body is a CSV
 * file. `truncated` is the field a screen must surface: it means the window
 * matched more rows than the file contains.
 */
export interface ProviderCallsExportMeta {
  /** Rows actually written into the file (excluding the header line). */
  rowCount: number;
  /** How many rows the window matched, before the cap. */
  totalMatching: number;
  /** `rowCount < totalMatching` — the file is not the whole answer. */
  truncated: boolean;
}

/**
 * What the export service returns.
 *
 * The CSV text and the cap headers travel together because a caller that gets
 * only the body cannot tell a complete export from a truncated one, and the
 * headers are the only place that fact exists.
 *
 * Column order is fixed by the server: `call_id, intent_id, created_at,
 * tool_id, status, classification, reason, verification_verdict,
 * provider_amount, platform_fee, price_amount, asset, decimals`.
 *
 * **`meta` is nullable, and that is not defensive typing.** A browser can only
 * read a response header the server names in `Access-Control-Expose-Headers`.
 * The API app used to name none, so cross-origin these three headers and
 * `Content-Disposition` were invisible to `fetch`/XHR and `meta` was always
 * `null`. **That is fixed** (assay-backend `src/bootstrap/api/main.ts` now exposes
 * all four; measured from the page). The nullable stays because a header can
 * stop being exposed again — and `null` means **the cap was not visible**,
 * which is a different fact from `truncated: false`. Reporting a synthetic zero here
 * would tell a provider their export is complete on exactly the evidence that
 * it might not be.
 */
export interface ProviderCallsExport {
  /** The raw `text/csv` body, CRLF-terminated, header line included. */
  csv: string;
  /** `null` when the cap headers were not readable — see above. Never a synthetic zero. */
  meta: ProviderCallsExportMeta | null;
  /** Parsed out of `Content-Disposition`, when that header is readable. */
  filename: string | null;
}

// ── Reconciliation ─────────────────────────────────────────────────────────

export interface ProviderReconciliationQuery extends ProviderReportWindow {
  /** CAIP-19 asset id. Required by the API when the window spans two assets. */
  asset?: string;
}

/** One class of `GET /providers/me/reconciliation`. Every class is sent, `calls: 0` included. */
export interface ProviderReconciliationClassRow {
  class: string;
  calls: number;
  /** 0..1 of every call in the window, from the whole ledger (never capped). */
  share: number;
  /** Σ provider_amount over the class's credited rows: net of the platform's take. */
  credited: Money | null;
  note: string;
}

/**
 * `GET /providers/me/reconciliation` — the month's class breakdown and
 * settlement, aggregated over the whole ledger (the per-call CSV is capped).
 *
 * `gross` is Σ price over the credited rows, `platformTake` Σ platform_fee over
 * the same rows and `net` Σ provider_amount, so `gross − platformTake = net`
 * and `net` is the sum of the classes' `credited`. `platformTakeRatePercent`
 * is the configured rate from the provider terms, NOT derived from the figures.
 */
export interface ProviderReconciliation {
  from: string;
  to: string;
  asset: string | null;
  callCount: number;
  classBreakdown: ProviderReconciliationClassRow[];
  unexplained: { calls: number; reference: string | null };
  gross: Money | null;
  platformTakeRatePercent: number;
  platformTake: Money | null;
  net: Money | null;
}
