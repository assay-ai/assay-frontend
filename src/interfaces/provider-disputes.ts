/**
 * The dispute form (dispute filing) and the case timeline (dispute case state).
 *
 * Two backend resources feed these screens, and neither is specific to them:
 *
 *  - `GET/POST /disputes`, `GET /disputes/:id` — assay-backend `src/modules/dispute/`.
 *    One table for every kind of objection: a provider disputing a
 *    verdict or an SLA window, or (see below) a provider disputing a slash
 *    proposal. Confirmed against a running response from
 *    a local API's `/disputes`.
 *  - `GET /providers/me/slash-proposals/:id`, `.../timeline`,
 *    `POST .../dispute` — assay-backend `src/modules/slash/`. The
 *    slash-proposal-specific objection flow the dispute form's design actually draws
 *    (header reads "proposed penalty $5.00", which only this flow has).
 *
 * ## `subjectType: 'SLASH_PROPOSAL'` is real and is not in the public enum
 *
 * assay-backend `src/modules/dispute/dto/dispute.dto.ts`'s `DisputeSubjectType`
 * enum only names `SLA_WINDOW | VERDICT | PAYMENT_INTENT`. But
 * `ArbitrationService.fileDispute` (assay-backend `src/modules/slash/services/
 * arbitration.service.ts` ~L128) writes `dispute.subjectType =
 * 'SLASH_PROPOSAL'` directly to the same `disputes` table, bypassing that
 * DTO's validation entirely (it constructs the entity itself, not through
 * `DisputeService.create`). A dispute reached from a slash proposal will read
 * back `subjectType: "SLASH_PROPOSAL"` from `GET /disputes/:id`, and no
 * client-side type should refuse to represent that. Reported as a doc/code
 * divergence — the DTO's own `@ApiProperty({ enum: DisputeSubjectType })`
 * undersells what the column actually holds.
 *
 * ## The two-clock gap
 *
 * `DisputeEntity` has a `platformDueAt` column, written by `fileDispute` for
 * every slash-originated dispute — but `DisputeService`'s `toDto` mapper
 * (assay-backend `src/modules/dispute/services/dispute.service.ts`) is an explicit
 * whitelist that does not include it, nor `outcome`, `resolutionKind` or
 * `reasonCodes`. So `GET /disputes/:id` **never** exposes the platform's own
 * clock, for any dispute, regardless of how it originated. The only place
 * both clocks are actually served is `SlashProposalDto.clocks`
 * (`SlashProposalClocks` below) — real for slash-proposal-originated
 * disputes, via `subjectId` (the proposal id). For every other dispute this
 * app renders only the provider's own `deadlineAt`, and says so rather than
 * inventing a platform deadline. See `src/features/provider-disputes/timeline.ts`.
 */

import type { ListQuery, Money } from "./api";

/** `chk_disputes_subject_type` names three; `SLASH_PROPOSAL` is a fourth the column actually holds. See file header. */
export type DisputeSubjectType = "SLA_WINDOW" | "VERDICT" | "PAYMENT_INTENT" | "SLASH_PROPOSAL";

/** Matches `chk_disputes_state` exactly (assay-backend `src/modules/dispute/dto/dispute.dto.ts`). */
export type DisputeState =
  | "OPEN"
  | "UNDER_REVIEW"
  | "UPHELD"
  | "PARTIALLY_UPHELD"
  | "REJECTED"
  | "WITHDRAWN";

export const TERMINAL_DISPUTE_STATES: readonly DisputeState[] = [
  "UPHELD",
  "PARTIALLY_UPHELD",
  "REJECTED",
  "WITHDRAWN",
];

/**
 * One dispute, as `GET /disputes` / `GET /disputes/:id` actually return it —
 * confirmed against the one real seed row (a `VERDICT` dispute, `claimType:
 * "POLICY_DEFECT"`, `state: "OPEN"`, every timestamp but `createdAt`/
 * `updatedAt` null).
 *
 * `claimType` is a plain string here, not `SlashDisputeClaimType` — the
 * general `/disputes` resource's own DTO comment says so explicitly ("open-
 * ended, not a closed enum"). Only the slash-proposal-specific filing path
 * enforces the seven-value enum; a dispute reached any other way may carry
 * any string a caller sent `POST /disputes` (`MAPPING_ERROR`,
 * `FALSE_POSITIVE`, … per that DTO's own examples).
 */
export interface Dispute {
  id: string;
  subjectType: DisputeSubjectType;
  subjectId: string;
  providerId: string | null;
  state: DisputeState;
  claimType: string;
  reason: string;
  evidence: unknown[];
  openedBy: string;
  acknowledgedAt: string | null;
  /** The provider's own deadline. Derived from `acknowledgedAt`, not `createdAt`. Null until acknowledged. */
  deadlineAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  /** What was given back. Null unless upheld in whole or in part. */
  restoredAmount: Money | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /disputes`. `state`/`subjectType`/`claimType`/`providerId` all narrow
 * — see assay-backend `src/modules/dispute/dto/list-disputes.dto.ts`.
 */
export interface ListDisputesQuery extends ListQuery {
  state?: DisputeState[];
  subjectType?: DisputeSubjectType;
  claimType?: string;
  providerId?: string;
}

/** `POST /disputes`'s body — the general path, used for anything not reached from a slash proposal. */
export interface CreateDisputeBody {
  subjectType: Exclude<DisputeSubjectType, "SLASH_PROPOSAL">;
  subjectId: string;
  claimType: string;
  reason: string;
  evidence?: unknown[];
}

/**
 * The dispute form's closed claim vocabulary. Mirrors
 * assay-backend `src/modules/slash/domain/arbitration.ts`'s `DisputeClaimType`
 * exactly — the seven values and their order. This enum is enforced ONLY on
 * the slash-proposal-specific filing endpoint (`FileSlashDisputeBodyDto`);
 * the general `/disputes` resource's `claimType` stays a free string (see
 * `Dispute.claimType` above).
 */
export type SlashDisputeClaimType =
  | "PLATFORM_MAPPING_CHANGE"
  | "AGENT_GRIEFING"
  | "POLICY_DEFECT"
  | "INSUFFICIENT_SAMPLE"
  | "UPSTREAM_INDUCED"
  | "DECLARED_INCIDENT"
  | "OTHER";

/** `POST /providers/me/slash-proposals/:id/dispute`'s body. */
export interface FileSlashDisputeBody {
  claimType: SlashDisputeClaimType;
  /** Optional in the UI's own copy; the wire requires 1–2048 chars. See the filing form for how the gap is closed. */
  reason: string;
  /** Ids of the calls the provider selected as supporting the claim. Defaults to `[]` server-side. */
  selectedCallIds?: string[];
}

export type SlashProposalRunningClock = "PROVIDER" | "PLATFORM" | "NONE";

/**
 * Both sides' clocks, together — `SlashProposalClocksDto`. the case timeline's subtitle
 * is a promise about exactly this shape: "both clocks are visible, including
 * ours."
 */
export interface SlashProposalClocks {
  proposedAt: string;
  /** Null until a notification channel confirms delivery. */
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  /** The provider's deadline to object. Null until delivery is confirmed. */
  respondByAt: string | null;
  /** OUR deadline to decide, set once a dispute is filed. Null before that. */
  platformDecisionDueAt: string | null;
  /** Nothing executes before this, even on total inaction. */
  earliestExecutionAt: string;
  /**
   * When the CHAIN will let a judgement be executed — `chain_proposed_at +
   * Config.slash_delay_seconds`, mirrored onto the row by the backend.
   *
   * Not the same instant as `earliestExecutionAt`, and later than it: the
   * backend proposes on chain once delivery stamps `respondByAt`, so the chain
   * clock starts at or after the off-chain one. Optional because older backends do not
   * send it; a screen that requires it would break the case brief there.
   *
   * This is the instant after which `execute_slash` is permissionless —
   * `execute_slash`'s `payer` is a bare `Signer` and is consulted about
   * nothing. It is therefore the operator's real deadline to cancel, and it is
   * the one clock the operator cannot afford to read off the wrong row.
   */
  chainExecutableAt?: string | null;
  /** The mirrored on-chain lifecycle. `undefined` on older backends. */
  chainStatus?: "NONE" | "PROPOSING" | "PENDING" | "EXECUTED" | "CANCELLED" | "REFUSED";
  secondsRemaining: number | null;
  runningClock: SlashProposalRunningClock;
}

/** The change-overlay banner backing the "platform mapping change" claim. Null when no edit falls inside the window. */
export interface SlashChangeOverlay {
  changedAt: string;
  changedBy: string;
  fromVersion: string;
  toVersion: string;
  verifiedBefore: number;
  failuresBefore: number;
  verifiedAfter: number;
  failuresAfter: number;
  rateBefore: number;
  rateAfter: number;
}

/** `failuresByAgent` / `failuresByRule` rows — backs the "griefing" claim's prefill. */
export interface SlashAttributionRow {
  key: string;
  count: number;
  share: number | null;
}

/**
 * A deliberate SUBSET of `SlashProposalCaseDto` — only the fields the dispute form's
 * filing header and prefill need. The full shape (arithmetic table, prior
 * windows, inaction forecast) is the slash case screen's; duplicating all of it here would
 * make the two screens' idea of "the proposal" drift. Extra fields the
 * backend returns are simply ignored, not an error.
 */
export interface SlashProposalSummary {
  id: string;
  status: string;
  providerId: string;
  bindingId: string;
  bindingLabel: string;
  toolId: string;
  toolName: string;
  windowId: string | null;
  windowLabel: string | null;
  penaltyAmount: Money;
  appliedAmount: Money | null;
  clocks: SlashProposalClocks;
  disputeId: string | null;
  /** `ArbitrationOutcome`, one of six — null while unresolved or for an automatic resolution kind. */
  outcome: string | null;
  /** `ResolutionKind` — null until resolved. */
  resolutionKind: string | null;
  resolvedAt: string | null;
  executedAt: string | null;
}

export interface SlashProposalCase {
  proposal: SlashProposalSummary;
  changeOverlay: SlashChangeOverlay | null;
  failuresByAgent: SlashAttributionRow[];
  evidenceVerdictCount: number;
  /** The claim the dispute form should pre-select — derived from evidence, not from the provider. Null when nothing suggests one. */
  suggestedClaim: SlashDisputeClaimType | null;
}

/** One row of the case timeline's case timeline — `SlashProposalEventDto`, verbatim. */
export interface SlashProposalEvent {
  id: string;
  occurredAt: string;
  kind: string;
  actorType: "provider" | "operator" | "system";
  actorId: string | null;
  /** Backend-produced sentence, e.g. "reviewer assigned · we respond by 2026-08-12 09:14 UTC". Render as-is; do not reconstruct. */
  summary: string;
  detail: Record<string, unknown>;
}

/** One row of the case timeline's restoration record — `RestorationRowDto`, verbatim. */
export interface SlashRestorationRow {
  label: string;
  value: string;
  status: "ON_DECISION" | "RESTORED" | "NOT_APPLICABLE";
}

export interface SlashProposalTimeline {
  events: SlashProposalEvent[];
  restoration: SlashRestorationRow[];
}
