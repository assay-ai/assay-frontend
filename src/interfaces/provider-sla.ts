/**
 * SLA windows and their evidence packs.
 *
 * Source: assay-backend `src/modules/provider/dto/get-sla-windows.dto.ts`.
 *
 * There IS a `sla_windows` table now. It replaced a fold
 * that computed a rolling UTC calendar day out of `payment_intents` at
 * request time — that fold's own docstring used to read "There is no
 * `sla_windows` table" here, and it was wrong about more than its own
 * existence: it also counted `SKIPPED`/`MISAPPLIED`/`DEGRADED` verdicts as
 * "verified", understating every provider's failure rate. A window is now a
 * real row, opened per **binding** (not per provider — `bindingId` is a
 * first-class column and filter), and closed on a real gate (verified-call
 * count or a 7-day deadline), not on the UTC calendar.
 */

import type { ListQuery } from "./api";

/**
 * `from`/`to` filter on `openedAt`. `bindingId` scopes to one binding —
 * omit it to see every window across every binding this provider owns.
 * `status`/`outcome` narrow further; `outcome` implies `status=CLOSED`.
 *
 * `search` is inherited from `ListQuery` and is **inert here**: the shared
 * query DTO accepts it, but this resource applies no free-text predicate, so
 * a search value is silently ignored rather than rejected. Do not offer a
 * search box against it. (`/verdicts` has the same defect on the buyer side.)
 */
export interface ListSlaWindowsQuery extends ListQuery {
  bindingId?: string;
  status?: SlaWindowStatus;
  outcome?: SlaWindowOutcome;
}

/** `OPEN` while accruing calls, `CLOSED` once the gate or the deadline fires. */
export type SlaWindowStatus = "OPEN" | "CLOSED";

/** Set only on a `CLOSED` window — `null` while `OPEN`. */
export type SlaWindowOutcome = "WITHIN_SLA" | "INSUFFICIENT_SAMPLE" | "BREACH_PROPOSED";

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

/** One row of `GET /providers/me/sla-windows` — the frozen half plus the live counters. */
export interface SlaWindow {
  /** The window id (uuid). Opaque — pass it back, do not build one. */
  windowId: string;
  /** Provider-facing name, e.g. `w_4482` — quotable in a dispute. Render this, not `windowId`. */
  label: string;
  /** 1-based, per binding. */
  sequence: number;
  bindingId: string;
  /** The tool this binding implements (the catalogue's slug id). */
  toolId: string;
  status: SlaWindowStatus;
  /** `null` while `OPEN`. */
  outcome: SlaWindowOutcome | null;
  openedAt: string;
  /** `openedAt` + the 7-day max age frozen at open. */
  deadlineAt: string;
  /** `null` while `OPEN`. */
  closedAt: string | null;
  /**
   * The binding's declared failure rate as it stood when this window opened,
   * `0..1`. May differ from the binding's current `slaFailureRate`, which
   * only takes effect at the next window boundary.
   */
  declaredFailureRate: number;
  /** Below this many verified calls, the window cannot be slashed at all. */
  minVerifiedCalls: number;
  /** Every call posted to this window, whatever its verdict. */
  totalCalls: number;
  /** Calls carrying a quality verdict — PASS or FAIL, nothing else. Not "has any verdict". */
  verifiedCalls: number;
  /** The subset of `verifiedCalls` whose verdict was FAIL. */
  failedCalls: number;
  /** `failedCalls / verifiedCalls`, `0..1`. `null` when `verifiedCalls` is 0 — never a bare 0%. */
  observedFailureRate: number | null;
  /** Sum of `price_amount` over every posted call, minor units. */
  totalCallAmount: string;
  assetId: string;
  /** The highest warning level already delivered for this window. */
  warningLevel: "WARNING" | "CRITICAL" | null;
  /**
   * Set when the window closed `INSUFFICIENT_SAMPLE`: this binding's sample
   * rate should be escalated until `minVerifiedCalls` is reachable.
   */
  samplingEscalationRequested: boolean;
}

/**
 * `GET /providers/me/sla-windows/{windowId}` (the SLA window screen — live SLA position).
 *
 * The window's stored columns (`SlaWindow`) plus its full live position,
 * computed server-side from those same columns — nothing here is re-derived
 * independently of what closed (or would close) the window.
 */
export interface SlaWindowPosition extends SlaWindow {
  /** Independent of `slashable` — a thin window can still project a breach. */
  state: "BELOW_SAMPLE_GATE" | "WITHIN_SLA" | "PROJECTED_BREACH";
  /** Has the window reached the sample gate? Below it no penalty is possible. */
  slashable: boolean;
  /** Wilson 99% interval. */
  confidenceInterval: ConfidenceInterval | null;
  /** The sample size the window is expected to have when it closes. */
  projectedSampleAtClose: number;
  /** The threshold that will apply at that size. */
  effectiveThresholdAtClose: number;
  toleranceAtClose: number;
  /** Failures the window can absorb in total, at the projected close size. */
  errorBudgetCalls: number;
  errorBudgetUsedCalls: number;
  errorBudgetRemainingCalls: number;
  /** `used / budget`. `null` when the budget is zero. Can exceed 1. */
  errorBudgetUsedFraction: number | null;
  /** Today's rate, held to close. */
  projectedFailureRate: number | null;
  projectedFailedCalls: number | null;
  /** Would the current rate, held to close, breach? */
  projectedBreach: boolean;
  /**
   * Is the observation already strong enough to say the true rate exceeds
   * the declaration — the one-sided 99% lower bound above `declaredFailureRate`.
   */
  confidentlyAboveDeclared: boolean;
}

export interface SlaWindowEvidenceCall {
  intentId: string;
  agentId: string;
  /** One of `VerdictStatus`, or the `UNVERIFIED` sentinel. */
  verdict: string | null;
  reasonCode: string | null;
  /** Did this call land in the denominator (a PASS or FAIL verdict)? */
  countedAsQuality: boolean;
  /** Did it land in the numerator? Implies `countedAsQuality`. */
  countedAsFailure: boolean;
  /** The call's price, minor units. */
  priceAmount: string;
  assetId: string;
  /** When the call was posted to the window — when it was judged, not made. */
  postedAt: string;
}

export interface SlaWindowFailureGroup {
  /** The reason code or agent id this group is keyed by. */
  key: string;
  count: number;
}

/**
 * Retrievable for **any** syntactically valid window id, whether or not it led
 * to a slash — providers audit their own quality continuously, not only when
 * accused. A window id that does not decode answers
 * `PROVIDER_SLA_WINDOW_NOT_FOUND`.
 */
export interface SlaWindowEvidence extends SlaWindow {
  calls: SlaWindowEvidenceCall[];
  /** Failing calls grouped by reason code, most common first. */
  failuresByReasonCode: SlaWindowFailureGroup[];
  /** Failing calls grouped by agent id, most active first. */
  failuresByAgentId: SlaWindowFailureGroup[];
}
