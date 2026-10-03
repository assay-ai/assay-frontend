/**
 * The provider's own verdict feed and detail.
 *
 * Source: assay-backend `src/modules/provider/dto/provider-verdict.dto.ts` and
 * assay-backend `src/modules/verification/dto/get-verdict.dto.ts` (the stage/
 * verifier/tally/decidedBy shapes, shared with the buyer's `/verdicts/:id`
 * and with the mapping tester). Verified against the running API — see
 * `provider-verdicts.service.ts`.
 *
 * `GET /providers/me/verdicts` is a **different route** from the buyer-side
 * `GET /verdicts` (`verdicts.service.ts`, not re-exported from the barrel —
 * see its own collision note). The buyer route scopes on the paying
 * organization and returns nothing for a provider token; this one scopes on
 * `provider_id` instead. Do not confuse the two, and do not name anything
 * here `listVerdicts` / `getVerdict` — those symbols already exist on the
 * buyer's service and the barrel could not `export *` both.
 */

import type { ListQuery, Money } from "./api";
/**
 * Reused, not redeclared: `provider-bindings.ts` (the mapping tester) already
 * exports a `VerificationStage` with these exact four members — a second
 * declaration here would collide on the barrel (`export *` from both files),
 * and the tester's verification pipeline and this route's are the same verification
 * pipeline, so the type is not a coincidence.
 */
import type { VerificationStage } from "./provider-bindings";

/**
 * The seven real values `verification_records.verdict_status` can hold.
 * Wider callers (`ToolCallDto.verdict`, `@/utils/verdict`'s `WireVerdict`)
 * also see `UNVERIFIED` and `null` — neither is a `VerdictStatus`, because
 * this column is only ever set once a call has actually been judged.
 */
export type VerdictStatus =
  | "PASS"
  | "FAIL"
  | "EMPTY_CONFIRMED"
  | "EMPTY_UNVERIFIED"
  | "MISAPPLIED"
  | "DEGRADED"
  | "SKIPPED";

/** The worker's own progress on this call, independent of the verdict. */
export type VerdictRecordState = "PENDING" | "JUDGED" | "SETTLED";

/** `payment_intents.call_class`. Null on a call written before the column existed. */
export type CallClass = "PAID" | "FREE" | "TEST" | "EXPLORATION";

/** Evidence body retention — `RAW` has bodies, `DIGESTED` has only hashes. */
export type RetentionState = "RAW" | "DIGESTED";

/**
 * `GET /providers/me/verdicts` query.
 *
 * There is no `bindingId` or `toolId` filter — verified on the wire, both
 * answer `400 property … should not exist` (the DTO's whitelist rejects
 * them). A binding-scoped screen therefore cannot ask the server to scope
 * the feed to one binding; see the feed page's own comment for how it works
 * around that. `windowId` **is** real, and an SLA window is itself scoped to
 * One binding, so filtering by the binding's current window is
 * exact rather than approximate.
 */
export interface ListProviderVerdictsQuery extends ListQuery {
  verdictStatus?: VerdictStatus[];
  /** Exact match on the decisive `reasonCode` — the doc's "rule" filter. */
  reasonCode?: string;
  agentId?: string;
  windowId?: string;
  /**
   * `from`/`to` (ISO-8601) — the shared `ListQueryDto` on the backend carries
   * these on every list endpoint, but the frontend's `ListQuery` (`./api`)
   * does not declare them (each resource adds them itself; see
   * `ListToolBindingsQuery` for the same pattern). The doc's "time" filter.
   */
  from?: string;
  to?: string;
}

/**
 * One row of the feed.
 *
 * Two fields the doc asks for have no honest source and are documented on
 * the wire type itself rather than guessed here:
 *
 * - `bindingVersion` is **always `null`** — no column records which
 *   `tool_bindings` mapping version was live when a call was mapped. Render
 *   `DASH`, never omit the column.
 * - `failingRules` is derived (every failed verifier's code, deduplicated),
 *   not the single stored `reasonCode` — see the backend DTO's class
 *   comment for why the two can differ.
 */
export interface ProviderVerdictListItem {
  id: string;
  intentId: string;
  toolId: string;
  callId: string | null;
  callClass: CallClass | null;
  state: VerdictRecordState;
  verdictStatus: VerdictStatus | null;
  reasonCode: string | null;
  score: number | null;
  failingRules: string[];
  agentId: string | null;
  decisionPolicyVersion: number | null;
  /** No source exists for this — always `null`. */
  bindingVersion: number | null;
  windowId: string | null;
  countedTowardWindow: boolean | null;
  retentionState: RetentionState | null;
  createdAt: string;
}

// ── Detail — shared shapes with the mapping tester's verifier vote ──

export type StageStatus =
  | "PASSED"
  | "FAILED"
  | "NOT_REACHED"
  | "NOT_APPLICABLE"
  | "NOT_IMPLEMENTED"
  | "MISAPPLIED"
  | "SKIPPED"
  | "UNAVAILABLE";

/** All four pipeline stages are always present, in pipeline order, never omitted. */
export interface VerdictStageResult {
  stage: VerificationStage;
  status: StageStatus;
  label: string;
  note: string | null;
  passed: boolean;
  code: string | null;
  detail: string | null;
  score: number | null;
}

export type VerifierOutcome = "PASS" | "FAIL" | "MISAPPLIED" | "UNAVAILABLE" | "ABSTAIN";

export interface VerifierVote {
  verifierId: string;
  outcome: VerifierOutcome;
  code: string | null;
  detail: string | null;
  score: number | null;
  costUsd: number;
  stage: VerificationStage | null;
}

export interface VoteTally {
  declared: number;
  votes: number;
  passed: number;
  failed: number;
  misapplied: number;
  unavailable: number;
  abstained: number;
  failedFraction: number | null;
  unregistered: number;
}

export type DecisionTrigger =
  | "FAILURES_AT_LEAST"
  | "FAILED_FRACTION_AT_LEAST"
  | "VERIFIER_FAILED"
  | "MISAPPLIED_AT_LEAST"
  | "VOTES_BELOW";

export interface DecidedBy {
  clauseIndex: number | null;
  trigger: DecisionTrigger | null;
  label: string | null;
}

/**
 * The production consequence — what happened to the money.
 *
 * `strike` is `settlementOutcome === 'REFUND'` exactly (the only outcome
 * that strikes); `null` while `JUDGED` and unsettled, not `false`. The four
 * money fields are `null` together only when `verification_records.intentId`
 * points at a `payment_intents` row that does not exist — a data-integrity
 * anomaly the backend reports as absence rather than a fabricated `$0.00`.
 */
export interface ProviderVerdictConsequence {
  settlementOutcome: "SETTLE" | "REFUND" | "VOID" | null;
  settledAt: string | null;
  intentStatus: string | null;
  strike: boolean | null;
  price: Money | null;
  providerAmount: Money | null;
  platformFee: Money | null;
  settledAmount: Money | null;
}

/**
 * `GET /providers/me/verdicts/:id`.
 *
 * Deliberately **not** the evidence pack — the five-pane body (mapped
 * request, upstream response, mapped output, coverage, verdict) lives behind
 * `evidenceUrl`, which another screen (the evidence pack screen, evidence pack browser) reads.
 * This screen links to it; it does not fetch the bodies itself.
 */
export interface ProviderVerdictDetail {
  id: string;
  intentId: string;
  toolId: string;
  state: VerdictRecordState;
  verdictStatus: VerdictStatus | null;
  reasonCode: string | null;
  reason: string | null;
  score: number | null;
  stageResults: VerdictStageResult[];
  verifiers: VerifierVote[];
  tally: VoteTally | null;
  decidedBy: DecidedBy | null;
  policyId: string | null;
  policyVersion: number | null;
  decisionPolicyId: string | null;
  decisionPolicyVersion: number | null;
  lifecycle: string | null;
  sampled: boolean | null;
  sampleRate: number | null;
  sampleDisplay: string | null;
  evaluatedAt: string | null;
  createdAt: string;
  consequence: ProviderVerdictConsequence;
  /** `/providers/me/verdicts/{id}/evidence` — relative to the API base, not the app. */
  evidenceUrl: string;
}
