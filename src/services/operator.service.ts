import type { CursorPage } from "@/interfaces/api";
import type {
  AdjudicationQueueRow, CancelIntent, CompensationIntent, DecideCaseBody,
  ExtendDeadlineBody, FleetSweep, ListQueueQuery, OpenFleetSweepBody,
  OperatorCaseBrief, OperatorIdentity, PlatformHealth, RecordCompensationBody,
  SecondSignatureBody, SuspendProposalBody,
} from "@/interfaces/operator";

import { operatorApi } from "./operator-api";

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

/** `POST /operator/cases/:id/suspend`. `ADJ`, `ADJL` or `SRE`. Legal wherever `CANCELLED` is reachable. */
export function suspendCase(proposalId: string, body: SuspendProposalBody): Promise<unknown> {
  return operatorApi.post<unknown>(
    `/operator/cases/${encodeURIComponent(proposalId)}/suspend`, body,
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
 * `POST /operator/cases/:id/sweep`. `ADJL`, plus a second operator.
 *
 * `approverToken` is another operator's own bearer token, sent as
 * `X-Operator-Approver`. The same token in both positions is refused as
 * `OPERATOR_SELF_APPROVAL_REFUSED` — checked before any status check.
 */
export function openFleetSweep(
  proposalId: string, body: OpenFleetSweepBody, approverToken: string,
): Promise<FleetSweep> {
  return operatorApi.post<FleetSweep>(
    `/operator/cases/${encodeURIComponent(proposalId)}/sweep`, body,
    { "X-Operator-Approver": approverToken },
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
 * **This route takes no second operator's token** — it is `@OverrideExempt`.
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
 * The chain signature and the operator token answer different questions and
 * neither substitutes for the other: the multisig's signature says the money
 * moved, the approver's token says two of our people agreed to close the case
 * on the strength of it. Self-approval is refused before the status is looked
 * at, exactly as on `sweep`.
 */
export function recordCompensation(
  proposalId: string, body: RecordCompensationBody, approverToken: string,
): Promise<unknown> {
  return operatorApi.post<unknown>(
    `/operator/cases/${encodeURIComponent(proposalId)}/compensated`, body,
    { "X-Operator-Approver": approverToken },
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
