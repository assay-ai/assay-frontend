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

// ── Traffic ────────────────────────────────────────────────────────────────

/**
 * `agentId` is `payment_intents.agent_id` — the only per-call agent
 * identifier that exists; there is no `mcp_sessions` table to join against.
 * When present it narrows both `buckets` and `agentBreakdown` to that one
 * caller; when absent `agentBreakdown` still ships, covering every agent that
 * called this provider in the window.
 */
export interface ProviderTrafficQuery extends ProviderReportWindow {
  agentId?: string;
}

export interface ProviderStatusCount {
  /** One of `PaymentIntentStatus`. */
  status: string;
  calls: number;
}

/**
 * One calling agent's volume over the whole window, not bucketed by
 * day — unlike {@link ProviderTrafficBucket}. `agentBreakdown` on
 * {@link ProviderTraffic} is grouped by `agentId` and ordered by `calls` desc,
 * server-truncated to the top 10 callers rather than zero-filled like the day
 * buckets: there is no fixed universe of agent ids to zero-fill against, and a
 * provider with more than 10 distinct callers in the window has no way to see
 * the rest through this field alone.
 */
export interface ProviderAgentTraffic {
  /** `payment_intents.agent_id` — an opaque UUID, not a design-style short handle. */
  agentId: string;
  calls: number;
  /** Every `PaymentIntentStatus`, zero-filled, for this agent alone. */
  byStatus: ProviderStatusCount[];
}

export interface ProviderTrafficBucket {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  calls: number;
  /** Every status, zero-filled — a status never disappears between buckets. */
  byStatus: ProviderStatusCount[];
  /**
   * Always `null` today. There is no per-day latency source: `payment_intents`
   * records no latency column, and `ProviderStats.p50LatencyMs` is a single
   * rolling snapshot rather than a daily bucket. Typed nullable so the screen
   * that eventually gets numbers does not change shape.
   */
  p50LatencyMs: number | null;
  /** See `p50LatencyMs` — always `null` today. */
  p95LatencyMs: number | null;
}

export interface ProviderTraffic {
  from: string;
  to: string;
  buckets: ProviderTrafficBucket[];
  totalCalls: number;
  /**
   * Calls per agent over the whole period, status split, ordered by `calls`
   * desc — top 10 callers. Narrowed to one agent when `agentId` is passed on
   * the request. See {@link ProviderAgentTraffic}.
   */
  agentBreakdown: ProviderAgentTraffic[];
}

// ── Quality ────────────────────────────────────────────────────────────────

export type ProviderQualityQuery = ProviderReportWindow;

export interface ProviderVerdictMixEntry {
  /** One of `VerdictStatus`, or `PENDING` for a call not yet judged. */
  verdict: string;
  calls: number;
  /** calls / total calls in the window. */
  share: number;
}

/**
 * `GET /providers/me/quality`.
 *
 * The three rates are **not** scoped by `from`/`to`. They are read off the
 * registry snapshot and carry its own rolling window (24h for availability,
 * 7d for quality). Only `verdictMix` and `totalCalls` answer the requested
 * window. A screen that labels all five with one date range is lying about
 * three of them.
 */
export interface ProviderQuality {
  paidQualityRate: number | null;
  freeQualityRate: number | null;
  availabilityRate: number | null;
  from: string;
  to: string;
  verdictMix: ProviderVerdictMixEntry[];
  totalCalls: number;
}

// ── Earnings ───────────────────────────────────────────────────────────────

export type ProviderEarningsGroupBy = "day" | "tool";

export interface ProviderEarningsQuery extends ProviderReportWindow {
  groupBy: ProviderEarningsGroupBy;
  /** CAIP-19 asset id. Required if the window spans more than one, else `PROVIDER_MULTIPLE_ASSETS`. */
  asset?: string;
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
  /** Σ provider_amount the provider would have earned had verification not withheld it. */
  withheld: Money | null;
  withheldCalls: number;
  /**
   * The part of `earned` the platform credited from its own funds because the
   * voucher could never be redeemed. Owed by the platform, not in the wallet.
   * Optional: older backends do not send it.
   */
  absorbed?: Money | null;
  absorbedCalls?: number;
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
