/**
 * The operator console's wire types.
 *
 * Mirrors assay-backend `src/modules/operator/dto/operator-console.dto.ts` and the
 * untyped return of `AdjudicationQueueService.brief()`. Verified against
 * `http://localhost:3000/api/v1/operator/*` on 2026-08-23.
 *
 * The brief's `case`, `timeline` and `restoration` are the SAME shapes the
 * provider console already renders, so they are imported rather than
 * redeclared. What is genuinely operator-only is the queue row, the identity,
 * the health tiles, the dispute record and the action bodies.
 */
import type { ListQuery, Money } from "./api";
import type { SlashProposalEvent, SlashRestorationRow } from "./provider-disputes";
import type { SlashProposalCaseDetail } from "./provider-slash-cases";

/** assay-backend `src/modules/operator/domain/override-register.ts` `OperatorRole`. */
export type OperatorRole =
  | "SRE" | "ADJ" | "ADJL" | "POL" | "POLA" | "TRE" | "TREA"
  | "BD" | "SUP" | "CMP" | "SEC";

/** `GET /operator/me`. Who holds this token, re-read from the row. */
export interface OperatorIdentity {
  id: string;
  /** The SSO subject, e.g. `ops-adjl`. */
  subject: string;
  displayName: string;
  roles: OperatorRole[];
  /** Per-action ceiling. Null means unbounded — correct for roles that move no money. */
  authorityLimit: Money | null;
  status: "ACTIVE" | "SUSPENDED";
}

/** `GET /operator/health` — the six tiles across the top of the operator console. */
export interface PlatformHealth {
  intentsPerMinute: number;
  /** Change against the same figure an hour ago, as a share. Null on a cold start. */
  intentsPerMinuteDeltaVsHour: number | null;
  verificationBacklog: number;
  /** p95 age of the backlog, in seconds. Null when the backlog is empty. */
  verificationBacklogP95AgeSeconds: number | null;
  /** Our own false-positive rate — overturns that count against us. */
  falsePositiveRate: number;
  /** The gate the rate is measured against — 0.02. */
  falsePositiveGate: number;
  policiesInShadow: number;
  policiesTotal: number;
  stakeLocked: Money;
  providersWithStake: number;
  openDisputes: number;
  oldestOpenDisputeAgeSeconds: number | null;
}

/**
 * assay-backend `src/modules/slash/domain/slash-proposal-state.ts`.
 *
 * Two of these mean something different in the current program version.
 *
 * `REVERSED` no longer means the program moved the money back — `reverse_slash`
 * does not exist. It means the treasury **compensated** the provider with a
 * plain `deposit_stake` into their stake, signed by the treasury's own signers,
 * and an operator recorded the confirmed signature. The name is kept because
 * the column and the override-register row are unchanged.
 *
 * `CANCEL_REQUESTED` is new. `cancel_slash` needs the program admin's own
 * signature (a person's hardware key) and the backend cannot produce one, so an
 * overturn no longer cancels on chain inside the request: it records the
 * decision and parks the case here until the admin's transaction lands. The
 * reconcile sweep that mirrors a record leaving `Pending` is what moves it on
 * to `CANCELLED`.
 */
export type SlashProposalStatus =
  | "PROPOSED" | "DISPUTED" | "UNDER_REVIEW" | "AWAITING_SECOND"
  | "UPHELD" | "OVERTURNED" | "EXECUTING" | "EXECUTED"
  | "REVERSED" | "WAIVED" | "CANCEL_REQUESTED" | "CANCELLED";

/** assay-backend `src/modules/slash/domain/arbitration.ts` `ArbitrationOutcome`. */
export type ArbitrationOutcome =
  | "UPHELD"
  | "UPHELD_RECALCULATED"
  | "OVERTURNED_PLATFORM_DEFECT"
  | "OVERTURNED_POLICY_DEFECT"
  | "OVERTURNED_GRIEFING"
  | "OVERTURNED_INSUFFICIENT_EVIDENCE";

/** assay-backend `src/modules/slash/domain/arbitration.ts` `DisputeClaimType`. */
export type OperatorDisputeClaimType =
  | "PLATFORM_MAPPING_CHANGE" | "AGENT_GRIEFING" | "POLICY_DEFECT"
  | "INSUFFICIENT_SAMPLE" | "UPSTREAM_INDUCED" | "DECLARED_INCIDENT" | "OTHER";

/**
 * One row of `GET /operator/queue`.
 *
 * Ordered by time-to-deadline then penalty size, **not** FIFO, and fixed
 * server-side so a caller cannot ask for insertion order.
 */
export interface AdjudicationQueueRow {
  proposalId: string;
  /** e.g. `w_4471 · bnd_7QK`. */
  caseLabel: string;
  disputeId: string | null;
  providerId: string;
  providerName: string;
  penaltyAmount: Money;
  claimType: OperatorDisputeClaimType | null;
  status: SlashProposalStatus;
  /** Our deadline. ISO-8601. */
  dueAt: string | null;
  secondsToDeadline: number | null;
  /** True once our deadline has passed — the sweeper overturns these against us. */
  overdue: boolean;
  /** The named owner. Null is rendered in red on purpose. */
  ownerSubject: string | null;
  rootCauseKey: string | null;
  /** How many open cases share this root cause, including this one. 1 when ungrouped. */
  rootCauseGroupSize: number;
  /** Other bindings on the same tool whose failure rate moved in the same period. */
  coFailureCount: number;
}

export interface ListQueueQuery extends ListQuery {
  mine?: boolean;
  unassigned?: boolean;
  overdue?: boolean;
  rootCauseKey?: string;
}

/**
 * The provider's objection, as the brief carries it.
 *
 * **This is the raw `DisputeEntity`, not a DTO** — `brief()` returns
 * `findOneBy()` unmapped. A different shape from the `Dispute` interface in
 * `provider-disputes.ts`, which models the `/disputes` DTO. Do not conflate.
 */
export interface OperatorDisputeRecord {
  id: string;
  organizationId: string;
  subjectType: string;
  subjectId: string;
  providerId: string | null;
  state: string;
  claimType: string;
  reason: string;
  evidence: unknown[];
  openedBy: string;
  acknowledgedAt: string | null;
  deadlineAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  restoredAmount: string | null;
  assetId: string | null;
  decimals: number | null;
  assignedOperatorId: string | null;
  assignedAt: string | null;
  /** Our own decision deadline. */
  platformDueAt: string | null;
  outcome: string | null;
  reasonCodes: string[];
  rubricVersion: string | null;
  resolutionKind: string | null;
  secondedByOperatorId: string | null;
  secondedAt: string | null;
  secondKind: string | null;
  secondNote: string | null;
}

/** `GET /operator/cases/:proposalId` — the full operator case brief. */
export interface OperatorCaseBrief {
  case: SlashProposalCaseDetail;
  dispute: OperatorDisputeRecord | null;
  timeline: SlashProposalEvent[];
  restoration: SlashRestorationRow[];
  /** True exactly when the proposal is `AWAITING_SECOND`. */
  requiresSecondSignature: boolean;
}

/** `POST /operator/cases/:id/decide`. */
export interface DecideCaseBody {
  outcome: ArbitrationOutcome;
  /** All must be valid for the chosen outcome — the API 422s otherwise. */
  reasonCodes: string[];
  /** At least 120 characters. Enforced by the DTO and again by a CHECK constraint. */
  note: string;
  rootCauseKey?: string;
  ticketRef?: string;
  /** Only for `UPHELD_RECALCULATED`: minor units, and never above the original. */
  recalculatedAmount?: string;
}

/** `POST /operator/cases/:id/second`. Note is at least 20 characters. */
export interface SecondSignatureBody {
  kind: "SIGNED" | "OBJECTED";
  note: string;
}

/** `POST /operator/cases/:id/suspend`. */
export interface SuspendProposalBody {
  /** At least 20 characters. */
  note: string;
  reasonCode: string;
  ticketRef?: string;
}

/** `POST /operator/cases/:id/extend-deadline`. */
export interface ExtendDeadlineBody {
  /** 1 to 336. */
  additionalHours: number;
  /** At least 20 characters. */
  note: string;
  reasonCode: string;
}

/** `POST /operator/cases/:id/sweep`. Two-person. */
export interface OpenFleetSweepBody {
  defectKey: string;
  /** 1 to 2160. */
  lookbackHours: number;
  /** At least 120 characters. */
  note: string;
  reasonCode: string;
}

export interface FleetSweep {
  id: string;
  outcome: ArbitrationOutcome;
  defectKey: string;
  windowFrom: string;
  windowTo: string;
  status: "OPEN" | "COMPLETED" | "FAILED";
  matchedCount: number;
  /** Lower than `matchedCount` when a match was already decided the same way. */
  appliedCount: number;
  openedBySubject: string;
  completedAt: string | null;
}

// ── The two transactions an operator gets built but cannot sign ────────────
//
// Both of these replace something the backend used to do by itself, and both
// are the same shape of answer: unsigned wire bytes plus the identity of the
// only key that may sign them. The platform holds neither key on purpose —
// that is the whole point of removing `reverse_slash` and of taking the
// verifier's signature off `cancel_slash`.

/**
 * `POST /operator/cases/:id/compensation-intent`.
 *
 * A wrongly-slashed provider is compensated by the **treasury depositing into
 * their stake** with an ordinary `deposit_stake`, not by a program door that
 * un-does a slash. So this is a build, never a send: the bytes come back
 * unsigned with the treasury as fee payer, and the treasury's signers (a
 * multisig) put the signatures on them.
 */
export interface CompensationIntent {
  /** Unsigned wire bytes, base64. */
  transaction: string;
  /** The provider being compensated — whose stake the deposit tops up. **Bare base58**, not CAIP-10. */
  provider: string;
  /** `applied` on the slash record: atomic units as a decimal integer string, never a number. */
  amountMinor: string;
  /** The treasury account that must sign and pay for this transaction. **Bare base58**, not CAIP-10. */
  depositor: string;
}

/**
 * `POST /operator/cases/:id/compensated` — `CompensatedBodyDto`.
 *
 * The confirmed signature of the deposit above, plus the override-register
 * paperwork every `S-5` action carries. The backend fetches the transaction,
 * checks it really contains a `deposit_stake` for that provider of at least
 * that amount, and only then writes the case to `REVERSED`.
 *
 * **Two independent authorisations, and the body is why neither is redundant.**
 * The signature proves the treasury's multisig moved the money; the note and
 * reason code — countersigned by a second operator's token in
 * `X-Operator-Approver` — are two of our people agreeing to close the case on
 * the strength of it. A chain signature cannot record why we accepted it, and
 * an override row cannot prove anything was paid.
 */
export interface RecordCompensationBody {
  /** Base58 transaction signature of the confirmed `deposit_stake`. */
  signature: string;
  /** At least 20 characters. Written to the override register verbatim. */
  note: string;
  reasonCode: string;
  ticketRef?: string;
}

/**
 * `POST /operator/cases/:id/cancel-intent`.
 *
 * `cancel_slash` is admin-signed. The backend can build it and nothing more, so
 * a case that an overturn (or a platform miss) has left in `CANCEL_REQUESTED`
 * waits here until the admin's own wallet signs and broadcasts these bytes.
 *
 * There is no "record the cancellation" route to match `compensated`: the
 * reconcile sweep that mirrors an on-chain record leaving `Pending` is what
 * moves the case to `CANCELLED`, so the screen's job ends at the broadcast.
 */
export interface CancelIntent {
  /** Unsigned wire bytes, base64. Fee payer is `Config.admin`. */
  transaction: string;
  /** `Config.admin` — the only key that can sign this. **Bare base58**, not CAIP-10. */
  admin: string;
  /** The slash request id the record PDA is seeded by. 32 bytes, lower-case hex. */
  requestId: string;
  /** The provider whose reservation the cancellation releases. **Bare base58**, not CAIP-10. */
  provider: string;
}
