import type { CursorPage } from "@/interfaces/api";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { toTwoPersonAnswer, type TwoPersonAnswer } from "@/features/operator/two-person";
import type {
  AccountBlock, AddOperatorBody, AdjudicationQueueRow, ApprovalDecision, ApprovalQueued,
  ArbiterBlockBody, ArbiterDispute, ArbiterRulingBody, ArbiterSupersededCancelBody,
  ArbiterSupersededRecord, ArbiterTerms, CancelIntent,
  ChangeOperatorBody, CreateAccountBlockBody, ListAccountBlocksQuery, ListOverrideLogQuery,
  OperatorApproval, OperatorApprovalStatus, OperatorChallenge, OperatorDirectoryEntry,
  OperatorSignIn, OperatorStatus, OverrideLogEntry, RemoveOperatorBody, UnblockAccountBody,
  CompensationIntent, DecideCaseBody, ExtendDeadlineBody, FleetSweep, ListQueueQuery,
  OpenFleetSweepBody, OperatorCaseBrief, OperatorIdentity, PlatformHealth,
  ListOperatorCasesQuery, OperatorCaseListRow,
  RecordCompensationBody, SecondSignatureBody, SuspendProposalBody,
  ManualCaseActionBody, ManualCaseActionResult,
} from "@/interfaces/operator";

import { operatorApi } from "./operator-api";

// ── Wallet sign-in ──────────────────────────────────────────────────────────

/** `POST /operator/auth/challenge` — the EIP-4361 message for this wallet to sign. */
export function requestOperatorChallenge(address: string): Promise<OperatorChallenge> {
  return operatorApi.post<OperatorChallenge>("/operator/auth/challenge", { address });
}

/**
 * `POST /operator/auth/verify`. 401 `OPERATOR_CREDENTIAL_INVALID`, 403
 * `OPERATOR_NOT_AUTHORIZED` (signed correctly, not an active operator), 429
 * `OPERATOR_AUTH_RATE_LIMITED`.
 */
export function verifyOperatorSignature(body: { message: string; signature: string }): Promise<OperatorSignIn> {
  return operatorApi.post<OperatorSignIn>("/operator/auth/verify", body);
}

/** `POST /operator/auth/logout` — revokes the session in the Authorization header (204). */
export async function logoutOperator(): Promise<void> {
  await operatorApi.post<unknown>("/operator/auth/logout");
}

/**
 * The operator console's API surface.
 *
 * Every function goes through `operatorApi`, never the shared `api`: the
 * operator token is a second authentication path and a 401 here must not sign
 * the Privy user out. See `src/services/operator-api.ts`.
 */

/** `GET /operator/me`. 401 when the token is unknown. */
export function getOperatorIdentity(): Promise<OperatorIdentity> {
  return operatorApi.get<OperatorIdentity>("/operator/me");
}

/** `GET /operator/health` — the six tiles. */
export function getPlatformHealth(): Promise<PlatformHealth> {
  return operatorApi.get<PlatformHealth>("/operator/health");
}

/**
 * `GET /operator/queue`.
 *
 * Draws only from `DISPUTED`, `UNDER_REVIEW` and `AWAITING_SECOND`, and only
 * where a platform decision deadline is set — a `PROPOSED` proposal never
 * appears. `mine`/`unassigned`/`overdue` are applied by the server AFTER
 * pagination, so a filtered page can come back empty with `hasMore` true.
 */
export function listAdjudicationQueue(
  query: ListQueueQuery = {},
): Promise<CursorPage<AdjudicationQueueRow>> {
  return operatorApi.get<CursorPage<AdjudicationQueueRow>>(
    "/operator/queue",
    query as Record<string, unknown>,
  );
}

/**
 * `GET /operator/cases` — every penalty, next deadline first. Any operator.
 *
 * Newer than some deployed backends: an older one has no such route and
 * answers 404, which the Penalties page reads as "no list here" and falls
 * back to the lists that do exist.
 */
export function listOperatorCases(
  query: ListOperatorCasesQuery = {},
): Promise<CursorPage<OperatorCaseListRow>> {
  const { status, ...rest } = query;
  return operatorApi.get<CursorPage<OperatorCaseListRow>>("/operator/cases", {
    ...rest,
    ...(status && status.length > 0 ? { status: status.join(",") } : {}),
  } as Record<string, unknown>);
}

/** `GET /operator/cases/:proposalId`. A cross-tenant id and an unknown one both 404. */
export function getOperatorCase(proposalId: string): Promise<OperatorCaseBrief> {
  return operatorApi.get<OperatorCaseBrief>(
    `/operator/cases/${encodeURIComponent(proposalId)}`,
  );
}

/** `POST /operator/cases/:id/claim`. `ADJ` or `ADJL`. */
export function claimCase(proposalId: string): Promise<unknown> {
  return operatorApi.post<unknown>(`/operator/cases/${encodeURIComponent(proposalId)}/claim`);
}

/**
 * `POST /operator/cases/:id/decide`. `ADJ` or `ADJL`.
 *
 * Refused unless the case is `DISPUTED` or `UNDER_REVIEW`; 422 when a reason
 * code is not valid for the outcome; `invalidTransition` when an upholding
 * outcome is decided from `UNDER_REVIEW` and no second signature is required.
 */
export function decideCase(proposalId: string, body: DecideCaseBody): Promise<unknown> {
  return operatorApi.post<unknown>(
    `/operator/cases/${encodeURIComponent(proposalId)}/decide`, body,
  );
}

/**
 * `POST /operator/cases/:id/second`. `ADJ` or `ADJL`.
 *
 * `AWAITING_SECOND` only, and refused when you are the operator who decided.
 * An objection returns the case to `UNDER_REVIEW` undecided.
 */
export function secondCase(proposalId: string, body: SecondSignatureBody): Promise<unknown> {
  return operatorApi.post<unknown>(
    `/operator/cases/${encodeURIComponent(proposalId)}/second`, body,
  );
}

/**
 * `POST /operator/cases/:id/suspend`. `ADJ`, `ADJL` or `SRE`. Legal wherever `CANCELLED` is reachable.
 * From `AWAITING_SECOND` and `UPHELD` it is two-person (`S-1`): answered 202
 * and run once a second operator approves it.
 */
export async function suspendCase(
  proposalId: string, body: SuspendProposalBody,
): Promise<TwoPersonAnswer<unknown>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<unknown>(
      `/operator/cases/${encodeURIComponent(proposalId)}/suspend`, body,
    ),
  );
}

/** `POST /operator/cases/:id/extend-deadline`. `ADJL`. `PROPOSED` with a non-null `respondByAt` only. */
export function extendCaseDeadline(
  proposalId: string, body: ExtendDeadlineBody,
): Promise<unknown> {
  return operatorApi.post<unknown>(
    `/operator/cases/${encodeURIComponent(proposalId)}/extend-deadline`, body,
  );
}

/**
 * `POST /operator/cases/:id/sweep`. `ADJL`, plus a second operator (`S-11`):
 * answered 202 and opened once an `ADJ` or `ADJL` operator approves it.
 */
export async function openFleetSweep(
  proposalId: string, body: OpenFleetSweepBody,
): Promise<TwoPersonAnswer<FleetSweep>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<FleetSweep | ApprovalQueued>(
      `/operator/cases/${encodeURIComponent(proposalId)}/sweep`, body,
    ),
  );
}

/**
 * `POST /operator/cases/:id/compensation-intent`. `ADJL` or `TRE`.
 *
 * **Builds, never sends.** `reverse_slash` is gone from the program: putting a
 * wrongly-taken penalty back is now the treasury depositing into the provider's
 * stake with an ordinary `deposit_stake`, and the treasury's signers are a
 * multisig this platform holds no key for. So the answer is unsigned bytes plus
 * the identity of who must sign them, and nothing has happened on chain when
 * this resolves.
 *
 * **This route needs no second operator** — it is `@OverrideExempt`.
 * Building bytes nobody has signed changes nothing, so there is nothing for a
 * maker/checker pair to guard. The two-person control sits on `compensated`
 * below, which is the step that writes to the case and the override register.
 */
export function createCompensationIntent(proposalId: string): Promise<CompensationIntent> {
  return operatorApi.post<CompensationIntent>(
    `/operator/cases/${encodeURIComponent(proposalId)}/compensation-intent`,
  );
}

/**
 * `POST /operator/cases/:id/compensated`. `ADJL` or `TRE`, **plus a second
 * operator** — it is override-register row `S-5`, the same row the `reverse` it
 * replaces occupied.
 *
 * Records the confirmed signature of the deposit built above and moves the case
 * to `REVERSED`. The backend fetches that transaction and checks it contains a
 * `deposit_stake` for this provider of at least the applied amount, so a
 * signature that paid the wrong account or too little is refused rather than
 * believed. A 409 means the slash was never executed, or was already
 * compensated.
 *
 * The chain signature and the second operator answer different questions and
 * neither substitutes for the other: the multisig's signature says the money
 * moved, the approval says two of our people agreed to close the case on the
 * strength of it. Answered 202 and recorded once an `ADJL` or `TRE` operator
 * approves it.
 */
export async function recordCompensation(
  proposalId: string, body: RecordCompensationBody,
): Promise<TwoPersonAnswer<unknown>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<unknown>(
      `/operator/cases/${encodeURIComponent(proposalId)}/compensated`, body,
    ),
  );
}

/**
 * B18 `POST /operator/cases/:id/close-nothing-standing`. `ADJL` or `TRE`, one
 * person (`S-15`). Closes a requested cancel whose record reads cancelled on
 * a fresh chain read; refused (409 `SLASH_MANUAL_ACTION_REFUSED`, or 503 when
 * the chain cannot be read) otherwise, with nothing changed.
 */
export function closeNothingStanding(proposalId: string, body: ManualCaseActionBody): Promise<ManualCaseActionResult> {
  return operatorApi.post<ManualCaseActionResult>(
    `/operator/cases/${encodeURIComponent(proposalId)}/close-nothing-standing`, body,
  );
}

/**
 * B18 `POST /operator/cases/:id/record-execution`. `ADJL` or `TRE`, plus a
 * second `ADJL` or `TRE` (`S-16`): answered 202 and run once approved.
 */
export async function recordStuckExecution(
  proposalId: string, body: ManualCaseActionBody,
): Promise<TwoPersonAnswer<ManualCaseActionResult>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<ManualCaseActionResult>(
      `/operator/cases/${encodeURIComponent(proposalId)}/record-execution`, body,
    ),
  );
}

/**
 * B18 `POST /operator/cases/:id/repropose`. `ADJL` or `TRE`, plus a second
 * `ADJ` or `ADJL` (`S-17`): answered 202 and run once approved; the
 * scheduler's next proposal pass then puts it on chain.
 */
export async function reproposeCase(
  proposalId: string, body: ManualCaseActionBody,
): Promise<TwoPersonAnswer<ManualCaseActionResult>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<ManualCaseActionResult>(
      `/operator/cases/${encodeURIComponent(proposalId)}/repropose`, body,
    ),
  );
}

/**
 * `POST /operator/cases/:id/cancel-intent`. `ADJL` or `TRE`.
 *
 * The other build-only route, and `@OverrideExempt` for the same reason. `cancel_slash` needs `Config.admin`'s signature —
 * a person's hardware key — so an overturned case sits in `CANCEL_REQUESTED`
 * until the admin signs and broadcasts these bytes. There is no route to record
 * that afterwards: the reconcile sweep mirrors the on-chain record and moves
 * the case to `CANCELLED` on its own.
 */
export function createCancelIntent(proposalId: string): Promise<CancelIntent> {
  return operatorApi.post<CancelIntent>(
    `/operator/cases/${encodeURIComponent(proposalId)}/cancel-intent`,
  );
}

/**
 * `GET /operator/blocks` — the account blocklist, newest first. Any operator.
 *
 * A wallet `subject` filter matches the way enforcement does, on any chain of
 * its namespace. An unparseable subject is `400 OPERATOR_BLOCK_SUBJECT_INVALID`.
 */
export function listAccountBlocks(
  query: ListAccountBlocksQuery = {},
): Promise<CursorPage<AccountBlock>> {
  return operatorApi.get<CursorPage<AccountBlock>>(
    "/operator/blocks",
    query as Record<string, unknown>,
  );
}

/**
 * `POST /operator/blocks` — override `A-9`. `ADJL` or `SRE`, single person.
 * One standing block per subject: a second is `409 OPERATOR_BLOCK_ALREADY_ACTIVE`.
 */
export function createAccountBlock(body: CreateAccountBlockBody): Promise<AccountBlock> {
  return operatorApi.post<AccountBlock>("/operator/blocks", body);
}

/**
 * `POST /operator/blocks/:id/unblock` — override `A-10`. `ADJL` or `SRE`, plus
 * a second operator holding `ADJL`: answered 202 and lifted once approved.
 */
export async function unblockAccount(
  blockId: string, body: UnblockAccountBody,
): Promise<TwoPersonAnswer<AccountBlock>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<AccountBlock | ApprovalQueued>(
      `/operator/blocks/${encodeURIComponent(blockId)}/unblock`, body,
    ),
  );
}

/** `GET /operator/override-log` — every manual intervention, newest first. Any operator. */
export function listOverrideLog(
  query: ListOverrideLogQuery = {},
): Promise<CursorPage<OverrideLogEntry>> {
  return operatorApi.get<CursorPage<OverrideLogEntry>>(
    "/operator/override-log",
    query as Record<string, unknown>,
  );
}

// ── D-19 · The arbiter page ─────────────────────────────────────────────────

/** `GET /operator/arbiter/terms?chainId=` — read live from the chain. Any operator. */
export function getArbiterTerms(chainId: string): Promise<ArbiterTerms> {
  return operatorApi.get<ArbiterTerms>(`/operator/arbiter/terms?chainId=${encodeURIComponent(chainId)}`);
}

/** `GET /operator/arbiter/disputes` — every record disputed on chain, oldest dispute first. */
export async function listArbiterDisputes(): Promise<ArbiterDispute[]> {
  const page = await operatorApi.get<{ items: ArbiterDispute[] }>("/operator/arbiter/disputes");
  return page.items;
}

/**
 * `POST /operator/arbiter/ruling-intent` — `S-13`, `ADJL` or `TRE`. The
 * arbiter's unsigned `upholdSlashBatch` or `cancelSlashBatch` over 1 to 64
 * records. Builds and logs; the case moves when the arbiter's transaction lands.
 */
export function createArbiterRulingIntent(body: ArbiterRulingBody): Promise<SlashContractCall> {
  return operatorApi.post<SlashContractCall>("/operator/arbiter/ruling-intent", body);
}

/**
 * `GET /operator/arbiter/superseded` — review R2-6: records of an earlier
 * proposal of their case that landed late and still stand, soonest door first.
 */
export async function listSupersededRecords(): Promise<ArbiterSupersededRecord[]> {
  const page = await operatorApi.get<{ items: ArbiterSupersededRecord[] }>("/operator/arbiter/superseded");
  return page.items;
}

/**
 * `POST /operator/arbiter/superseded/cancel-intent` — `S-13`, `ADJL` or `TRE`.
 * The arbiter's unsigned `cancelSlashBatch` of ONE superseded record; 409 when
 * the id is not one. Builds and logs; nothing is sent.
 */
export function createSupersededCancelIntent(body: ArbiterSupersededCancelBody): Promise<SlashContractCall> {
  return operatorApi.post<SlashContractCall>("/operator/arbiter/superseded/cancel-intent", body);
}

/**
 * `POST /operator/arbiter/block-intent` — `A-11`, `ADJL`, `SRE` or `TRE`. The
 * arbiter's unsigned `setBlocked(account, true)`. Two-person: answered 202, and
 * the approver gets the unsigned call as the approval's result.
 */
export async function createArbiterBlockIntent(
  body: ArbiterBlockBody,
): Promise<TwoPersonAnswer<SlashContractCall>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<SlashContractCall | ApprovalQueued>("/operator/arbiter/block-intent", body),
  );
}

/**
 * `GET /operator/arbiter/blocks/:approvalId/call` — the unsigned
 * `setBlocked(account, true)` of an APPROVED `A-11`, rebuilt from the approved
 * payload for the arbiter's wallet (frontend review N5). 409 once the address
 * is blocked on chain, or for any other approval.
 */
export function getApprovedArbiterBlockCall(approvalId: string): Promise<SlashContractCall> {
  return operatorApi.get<SlashContractCall>(
    `/operator/arbiter/blocks/${encodeURIComponent(approvalId)}/call`,
  );
}

// ── The operator directory (`OPS_ADMIN` writes) ─────────────────────────────

/** `GET /operator/operators[?status=]` — newest first. Any operator may read. */
export function listOperators(
  query: { status?: OperatorStatus; cursor?: string; limit?: number } = {},
): Promise<CursorPage<OperatorDirectoryEntry>> {
  return operatorApi.get<CursorPage<OperatorDirectoryEntry>>("/operator/operators", query);
}

/** `POST /operator/operators` — `A-12`, always two-person: answered 202. */
export async function addOperator(
  body: AddOperatorBody,
): Promise<TwoPersonAnswer<OperatorDirectoryEntry>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<OperatorDirectoryEntry | ApprovalQueued>("/operator/operators", body),
  );
}

/**
 * `PATCH /operator/operators/:id` — `A-13`. Lowering: 200, applied. Adding a
 * role, raising the limit or taking `OPS_ADMIN` away: 202.
 */
export async function changeOperator(
  operatorId: string, body: ChangeOperatorBody,
): Promise<TwoPersonAnswer<OperatorDirectoryEntry>> {
  return toTwoPersonAnswer(
    await operatorApi.patchWithStatus<OperatorDirectoryEntry | ApprovalQueued>(
      `/operator/operators/${encodeURIComponent(operatorId)}`, body,
    ),
  );
}

/**
 * `POST /operator/operators/:id/remove` — `A-14`; ends every session they
 * hold. Single-person, except removing an `OPS_ADMIN`: answered 202.
 */
export async function removeOperator(
  operatorId: string, body: RemoveOperatorBody,
): Promise<TwoPersonAnswer<OperatorDirectoryEntry>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<OperatorDirectoryEntry | ApprovalQueued>(
      `/operator/operators/${encodeURIComponent(operatorId)}/remove`, body,
    ),
  );
}

// ── Two-person approvals ────────────────────────────────────────────────────

/** `GET /operator/approvals[?status=&action=]` — newest first. Any operator. */
export function listApprovals(
  query: { status?: OperatorApprovalStatus; action?: string; cursor?: string; limit?: number } = {},
): Promise<CursorPage<OperatorApproval>> {
  return operatorApi.get<CursorPage<OperatorApproval>>("/operator/approvals", query);
}

/** `POST /operator/approvals/:id/approve` — by a different operator; re-runs the action now. */
export function approveApproval(approvalId: string): Promise<ApprovalDecision> {
  return operatorApi.post<ApprovalDecision>(
    `/operator/approvals/${encodeURIComponent(approvalId)}/approve`,
  );
}

/** `POST /operator/approvals/:id/reject` — by an eligible approver, or by the requester to withdraw. */
export function rejectApproval(approvalId: string): Promise<ApprovalDecision> {
  return operatorApi.post<ApprovalDecision>(
    `/operator/approvals/${encodeURIComponent(approvalId)}/reject`,
  );
}
