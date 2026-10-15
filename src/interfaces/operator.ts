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
  | "BD" | "SUP" | "CMP" | "SEC" | "OPS_ADMIN";

export type OperatorStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";

/** `GET /operator/me` (`OperatorDto`). Who is signed in, re-read from the row. */
export interface OperatorIdentity {
  id: string;
  /** A short handle, e.g. `dan@`. */
  subject: string;
  displayName: string;
  /** The EVM address the operator signs in with, lower-case. */
  walletAddress: string | null;
  roles: OperatorRole[];
  /** Per-action ceiling. Null means unbounded — correct for roles that move no money. */
  authorityLimit: Money | null;
  status: OperatorStatus;
}

// ── Wallet sign-in ──────────────────────────────────────────────────────────

/** `POST /operator/auth/challenge` → the EIP-4361 message to sign, verbatim. */
export interface OperatorChallenge {
  message: string;
  nonce: string;
  /** Five minutes after issue. */
  expiresAt: string;
}

/** `POST /operator/auth/verify` → the session. */
export interface OperatorSignIn {
  /** Send as `Authorization: Bearer <token>` on operator calls only. */
  token: string;
  expiresAt: string;
  operator: OperatorIdentity;
}

// ── The directory ───────────────────────────────────────────────────────────

/** `OperatorDirectoryEntryDto` — one row of `GET /operator/operators`. */
export interface OperatorDirectoryEntry extends OperatorIdentity {
  email: string;
  lastSeenAt: string | null;
  createdAt: string;
}

/** `POST /operator/operators` — `A-12`. Always answered 202. */
export interface AddOperatorBody {
  walletAddress: string;
  subject: string;
  displayName?: string;
  roles: OperatorRole[];
  /** Minor units of the platform asset. Absent: 0. Null: unbounded. */
  authorityLimitMinor?: string | null;
  reasonCode: string;
  /** 10 to 2048 characters. */
  note: string;
}

/** `PATCH /operator/operators/:id` — `A-13`. Lowering: 200. Raising: 202. */
export interface ChangeOperatorBody {
  /** The full new set. Absent keeps it. */
  roles?: OperatorRole[];
  authorityLimitMinor?: string | null;
  reasonCode: string;
  note: string;
}

/** `POST /operator/operators/:id/remove` — `A-14`, at once. */
export interface RemoveOperatorBody {
  reasonCode: string;
  note: string;
}

// ── Two-person approvals ────────────────────────────────────────────────────

export type OperatorApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

/** What a two-person route answers, with HTTP 202, when it queued the action. */
export interface ApprovalQueued {
  approvalId: string;
  status: "PENDING";
  /** e.g. `account.unblock`. */
  action: string;
  expiresAt: string;
}

/** `OperatorApprovalDto` — one row of `GET /operator/approvals`. */
export interface OperatorApproval {
  id: string;
  /** e.g. `slash.suspend`, `account.unblock`, `operator.add`. */
  action: string;
  /** The register row the action writes, e.g. `A-10`. */
  code: string;
  /** `<type>:<id>` of what the action is about. */
  target: string;
  /** The original request, exactly as it will be re-run. */
  payload: Record<string, unknown>;
  status: OperatorApprovalStatus;
  /** Subject of the operator who asked. */
  requestedBy: string;
  requestedById: string;
  approvedBy: string | null;
  rejectedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

/** `POST /operator/approvals/:id/approve|reject`. */
export interface ApprovalDecision {
  approval: OperatorApproval;
  /** On approve: what the action's own route would have answered. */
  result?: unknown;
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
  /** The EVM chain-state cache, one row per chain. Absent on an older backend. */
  chainState?: ChainStateHealth[];
  /** Every provider on a slash hold, one row per provider and chain. Absent on an older backend. */
  slashHolds?: SlashHoldHealth[];
}

/** `SlashHoldHealthDto` — a provider whose paid calls are not routed on one chain. */
export interface SlashHoldHealth {
  /** The provider's organization id. */
  providerId: string;
  chainId: string;
  /** `SLASH_WINDOW_FULL`, `STAKE_FULLY_RESERVED`, `BONDED_BELOW_MINIMUM`, or a newer one as it came. */
  reasons: string[];
  heldSince: string;
  /** When the monitor last re-checked it; `null` if never. */
  checkedAt: string | null;
}

/**
 * `ChainStateHealthDto` — what the EVM chain-state indexer last read of one
 * chain's `X402Config`. `stale` when the indexer never caught up or lags more
 * than `EVM_CHAIN_STATE_MAX_LAG_MS` (five minutes by default).
 */
export interface ChainStateHealth {
  chainId: string;
  paused: boolean;
  /** `X402Config.arbiter()`, lower-case, or `null`. */
  arbiter: string | null;
  /** The live slash delay — the dispute window. */
  slashDelaySeconds: number | null;
  blockedCount: number;
  indexedBlock: string | null;
  headBlock: string | null;
  lagSeconds: number | null;
  stale: boolean;
  reconciledAt: string | null;
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

/** assay-backend `src/modules/slash/domain/chain-slash-outcome.ts` `ChainProposalStatus`. */
export type ChainProposalStatus =
  | "NONE" | "PROPOSING" | "PENDING" | "CANCEL_REQUESTED" | "DISPUTED"
  | "EXECUTED" | "CANCELLED" | "REFUSED";

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

/**
 * Where a penalty stands, as `GET /operator/cases` groups it: the case status
 * and the mirrored on-chain status read in the case screen's precedence.
 * `DISPUTED` is the retired off-chain objection process; a dispute on chain is
 * `CHAIN_DISPUTED`.
 */
export type OperatorCaseStatus =
  | "PROPOSED"
  | "DISPUTED"
  | "CHAIN_DISPUTED"
  | "CANCEL_REQUESTED"
  | "EXECUTED"
  | "CANCELLED"
  | "COMPENSATED"
  | "EXPIRED";

/** One row of `GET /operator/cases`. Fixed order: next deadline, then amount, then newest. */
export interface OperatorCaseListRow {
  proposalId: string;
  providerId: string;
  providerName: string;
  toolName: string | null;
  amount: Money;
  /** CAIP-2. */
  chainId: string;
  status: OperatorCaseStatus;
  proposedAt: string;
  /** When the provider disputed it on chain. */
  disputedAt: string | null;
  /** The next instant it moves on its own (lapses, must be signed by, executable from). Null once closed. */
  nextDeadline: string | null;
}

export interface ListOperatorCasesQuery {
  status?: OperatorCaseStatus[];
  providerId?: string;
  cursor?: string;
  /** 1 to 100. */
  limit?: number;
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
  /**
   * The on-chain record's status (`slash_proposals.chain_status`), read-only.
   * Not the case status: an overturned case waiting for the settlement admin's
   * `cancel_slash` reads `OVERTURNED` here and `CANCEL_REQUESTED` there.
   */
  chainStatus: ChainProposalStatus;
  /**
   * When the on-chain record becomes executable (`chain_executable_at`),
   * read-only. From this moment anyone can execute the penalty, so it is the
   * deadline for a requested cancel. Null while nothing stands on chain;
   * absent from a backend that predates the field.
   */
  chainExecutableAt?: string | null;
  /**
   * How many of the case's current parts are disputed on chain (audit E-4).
   * With `chainStatus: PENDING` and a non-zero count the case is partly
   * disputed: the other parts keep executing. Absent from an older backend.
   */
  chainDisputedParts?: number;  /** The provider's penalties upheld or executed in the last 30 days (follow-up C4). Absent from an older backend. */
  upheldViolations30d?: number;
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
 * reason code — approved by a second operator from the approvals inbox — are
 * two of our people agreeing to close the case on
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
  /**
   * Solana: unsigned wire bytes, base64, fee payer `Config.admin`. EVM: the
   * `cancelSlash` calldata, `0x`-hex, sent to {@link CancelIntent.to}.
   */
  transaction: string;
  /**
   * The only key that can sign this. Solana: `Config.admin`, **bare base58**.
   * EVM: always `X402Config.arbiter()` (D-19); without an arbiter the build is
   * refused with `409 CHAIN_ARBITER_NOT_SET`.
   */
  admin: string;
  /** EVM: always `ARBITER`. Absent on Solana, where `admin` is `Config.admin`. */
  signerRole?: "ARBITER";
  /** EVM only: the X402Stake proxy the calldata is sent to. */
  to?: string;
  /** The slash request id the record PDA is seeded by. 32 bytes, lower-case hex. */
  requestId: string;
  /** The provider whose reservation the cancellation releases. **Bare base58**, not CAIP-10. */
  provider: string;
}

// ── A-9 / A-10 · The account blocklist ─────────────────────────────────────

/** assay-backend `src/modules/blocklist/domain/account-block.ts` `BlockSubjectKind`. */
export type BlockSubjectKind = "ORGANIZATION" | "WALLET";

/**
 * `AccountBlockDto` — one row of `GET /operator/blocks`, and the answer of
 * both writes. The row is the record: a lifted block keeps its row, and a
 * later block of the same subject is a new one.
 */
export interface AccountBlock {
  id: string;
  subjectKind: BlockSubjectKind;
  /** Normalised: uuid lower-case, EVM address lower-case. */
  subject: string;
  /** What enforcement matches on: the uuid, or `namespace:address` (no chain reference). */
  subjectKey: string;
  active: boolean;
  reasonCode: string;
  /** Internal. Never shown to the blocked account. */
  note: string;
  ticketRef: string | null;
  /** Operator subject, e.g. `ops-sre`. */
  blockedBy: string;
  blockedAt: string;
  unblockedBy: string | null;
  unblockApprovedBy: string | null;
  unblockedAt: string | null;
  unblockNote: string | null;
}

/** `GET /operator/blocks` filters. Any operator may read. */
export interface ListAccountBlocksQuery {
  cursor?: string;
  limit?: number;
  subjectKind?: BlockSubjectKind;
  /** A uuid or a CAIP-10 account; a wallet matches on any chain of its namespace. */
  subject?: string;
  /** `true` standing blocks only, `false` lifted ones only, absent both. */
  active?: boolean;
  reasonCode?: string;
}

/** `POST /operator/blocks` — `A-9`, `ADJL` or `SRE`, single person. */
export interface CreateAccountBlockBody {
  subjectKind: BlockSubjectKind;
  /** An organization uuid, or a CAIP-10 account. */
  subject: string;
  reasonCode: string;
  /** 20 to 4096 characters. Internal. */
  note: string;
  ticketRef?: string;
}

/**
 * `POST /operator/blocks/:id/unblock` — `A-10`, `ADJL` or `SRE`, two person:
 * answered `202 { approvalId }`, and lifted once a second operator holding
 * `ADJL` approves it in the approvals inbox.
 */
export interface UnblockAccountBody {
  reasonCode: string;
  /** 20 to 4096 characters. */
  note: string;
  ticketRef?: string;
}

/** `OverrideLogEntryDto` — one row of `GET /operator/override-log`. */
export interface OverrideLogEntry {
  id: string;
  createdAt: string;
  family: string;
  code: string;
  label: string;
  action: string;
  actorSubject: string;
  approverSubject: string | null;
  approvalMode: string;
  targetType: string;
  targetId: string;
  organizationId: string | null;
  reasonCode: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  ticketRef: string | null;
  breakGlass: boolean;
}

/** `GET /operator/override-log` filters. */
export interface ListOverrideLogQuery {
  cursor?: string;
  limit?: number;
  targetType?: string;
  targetId?: string;
  ticketRef?: string;
  q?: string;
}

// ── D-19 · The arbiter page ─────────────────────────────────────────────────

/** `GET /operator/arbiter/terms?chainId=` — the Config's dispute terms, read live from the chain. */
export interface ArbiterTerms {
  chainId: string;
  paused: boolean;
  /** `X402Config.arbiter()`, checksummed, or `null` for none appointed. */
  arbiter: string | null;
  /** `X402Config.admin()`, checksummed. */
  admin: string;
  /** The delay a proposal made now would freeze into its `executableAt`. */
  slashDelaySeconds: number;
  /** `params().slashAgentBps`: the beneficiary's share of an executed slash, in basis points. */
  slashAgentBps: number;
}

/**
 * Follow-up C5: whether the beneficiary of a disputed record is a payer of the
 * window's failed calls, and whether the record's part stays within that
 * payer's pro-rata share of the formula penalty (`beneficiaryEvidence` in
 * assay-backend `slash-beneficiary-evidence.ts`). Amounts are atomic units of
 * the stake asset, as decimal strings.
 */
export interface ArbiterBeneficiaryEvidence {
  /** The payer of the failed calls' vouchers, CAIP-10, or `null` when none was found. */
  payer: string | null;
  failedCalls: number;
  /** What the payer signed for the failed calls (refunded off chain). */
  paidAmount: string;
  /**
   * The payer's pro-rata share, by failed spend, of the case penalty: the most
   * the record's part may be (plus one atomic unit of rounding). Absent from a
   * backend before c3440d7.
   */
  formulaShareAmount?: string;
  /** The part of it whose intent was redeemed. */
  redeemedAmount: string;
  /** The beneficiary's payout if executed: `penalty × slashAgentBps / 10 000`, floored. */
  shareAmount: string;
  /** The beneficiary is the payer, and the part is within its formula share. */
  ok: boolean;
  /** Why the check fails, in the backend's words; `null` when `ok`. */
  reason: string | null;
}

/** One row of `GET /operator/arbiter/disputes` (`{ items }`), oldest dispute first. */
export interface ArbiterDispute {
  /** `0x` + 64 lower-case hex. */
  requestId: string;
  proposalId: string;
  providerId: string;
  chainId: string;
  caseStatus: string;
  caseChainStatus: string;
  /** Atomic units of the stake asset, as a decimal string. */
  penaltyAmount: string;
  reservedAmount: string | null;
  disputedAt: string | null;
  executableAt: string | null;
  /** `disputedAt + 30 d`: from then `expireSlash` releases it with `DisputeUnresolved`. */
  expiresAt: string | null;
  /**
   * The provider's slash cases it lost in the last 30 days (follow-up C4,
   * review R2-1): a record executed on chain, or the arbiter's on-chain uphold.
   * Never a case closed in its favour, a key lapse, or a record the platform
   * did not execute in time.
   */
  upheldViolations30d: number;
  /** CAIP-10: who the record pays its agent share to. */
  beneficiary: string;
  /** `null` when the backend could not check it (no window, or the chain's terms unreadable). */
  beneficiaryEvidence: ArbiterBeneficiaryEvidence | null;
}

/**
 * Review R2-6: `GET /operator/arbiter/superseded` — a record of an EARLIER
 * proposal of its case that landed on chain late and still stands. It covers
 * the same calls as the case's current records, so executing it would charge
 * them twice; Assay never executes it, and the arbiter cancels it.
 */
export interface ArbiterSupersededRecord {
  /** `0x` + 64 lower-case hex. */
  requestId: string;
  proposalId: string;
  providerId: string;
  chainId: string;
  /** `PENDING` or `DISPUTED` on chain. */
  chainStatus: string;
  /** The record's epoch, and the case's current one (always later). */
  recordEpoch: number;
  caseEpoch: number;
  penaltyAmount: string;
  reservedAmount: string | null;
  /** From then anyone can execute it: the arbiter's deadline to cancel. */
  executableAt: string | null;
}

/** `POST /operator/arbiter/superseded/cancel-intent` — `S-13`, one superseded record. */
export interface ArbiterSupersededCancelBody {
  chainId: string;
  requestId: string;
  reasonCode: string;
  note: string;
  ticketRef?: string;
}

export type ArbiterRuling = "UPHOLD" | "CANCEL";

/** `POST /operator/arbiter/ruling-intent` — `S-13`. */
export interface ArbiterRulingBody {
  chainId: string;
  ruling: ArbiterRuling;
  /** 1 to 64, `0x` + 64 hex. */
  requestIds: string[];
  reasonCode: string;
  /** At least 20 characters. */
  note: string;
  ticketRef?: string;
}

/** `POST /operator/arbiter/block-intent` — `A-11`. Block only. */
export interface ArbiterBlockBody {
  chainId: string;
  /** `0x` + 40 hex. */
  account: string;
  reasonCode: string;
  note: string;
  ticketRef?: string;
}
