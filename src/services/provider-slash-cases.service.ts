import type {
  SlashProposalCaseDetail,
  SlashRequestLookup,
} from "@/interfaces/provider-slash-cases";
import type { DisputeSlashRequestsBody, SlashContractCall } from "@/interfaces/slash-dispute";

import { api } from "./api";

/**
 * The slash case screen's two reads and its one non-destructive write.
 *
 * `getSlashProposalTimeline` and `fileSlashDispute` are **not** repeated here
 * — they already exist in `provider-disputes.service.ts` and this screen
 * imports them from there. What is here is what that file does not have: the
 * full case shape (it types a deliberate subset) and `acknowledge`, which no
 * other screen calls.
 */

/**
 * `GET /providers/me/slash-proposals/:id` — the whole case.
 *
 * The same endpoint `getSlashProposalCase` reads, typed as the full DTO
 * rather than the dispute form's subset. Deliberately shares the cache key
 * `["provider", "slash-proposal-case", proposalId]` with that function, so
 * mounting the filing form inline on this screen reuses the response already
 * in hand instead of asking for it again.
 *
 * A proposal in another organization and one that does not exist both answer
 * 404 `SLASH_PROPOSAL_NOT_FOUND` — "not yours" and "not found" are the same
 * error, and the screen must not write copy that separates them.
 */
export function getSlashProposalCaseDetail(proposalId: string): Promise<SlashProposalCaseDetail> {
  return api.get<SlashProposalCaseDetail>(
    `/providers/me/slash-proposals/${encodeURIComponent(proposalId)}`
  );
}

/**
 * `POST /providers/me/slash-proposals/:id/acknowledge` — "I have seen this".
 *
 * Moves **no clock**. The controller's own docstring is explicit: the
 * provider's response window runs from delivery, not from reading, so a
 * provider who never opens the dashboard has exactly as long to object as one
 * who opens it immediately. The button therefore promises nothing about the
 * deadline, and this screen says so.
 *
 * Returns the whole case again, which is seeded straight into the cache
 * rather than triggering a refetch: provider `GET`s are HTTP-cached for 10s
 * with an hour of stale-while-revalidate, so a refetch here would be served
 * the pre-write body.
 */
export function acknowledgeSlashProposal(proposalId: string): Promise<SlashProposalCaseDetail> {
  return api.post<SlashProposalCaseDetail>(
    `/providers/me/slash-proposals/${encodeURIComponent(proposalId)}/acknowledge`,
    {}
  );
}

/** The most ids `POST /providers/me/slash-requests/lookup` takes in one call. */
export const SLASH_REQUEST_LOOKUP_MAX = 200;

/**
 * `POST /providers/me/slash-requests/lookup` — which of these on-chain slash
 * request ids are cases of this provider's.
 *
 * A `POST` only because the list does not fit a query string; it writes
 * nothing. At most {@link SLASH_REQUEST_LOOKUP_MAX} ids, each `0x` + 64 hex.
 * An id that is not one of this provider's cases is absent from `matches`,
 * whether it is unknown or another provider's. Chunking is the caller's job —
 * see `lookupAssayCases`.
 *
 * Refused for a blocked account like every other non-`GET`.
 */
export function lookupSlashRequests(requestIds: readonly string[]): Promise<SlashRequestLookup> {
  return api.post<SlashRequestLookup>("/providers/me/slash-requests/lookup", {
    requestIds,
  });
}

/**
 * `POST /providers/me/slash-requests/dispute-intent` — the unsigned
 * `disputeSlashBatch` for the signed-in provider's own stake wallet, 1 to 64
 * ids. Builds only: nothing changes until the provider's wallet sends it.
 *
 * Open to a blocked provider (`@BlockedSessionReadOnly` on the backend, and in
 * `READ_ONLY_POSTS` here), because the chain lets a blocked provider dispute.
 *
 * - `422 SLASH_CHAIN_BATCH_REFUSED` — one or more ids would revert the batch;
 *   see `features/chain-calls/refusals.ts`.
 */
export function createSlashDisputeIntent(body: DisputeSlashRequestsBody): Promise<SlashContractCall> {
  return api.post<SlashContractCall>("/providers/me/slash-requests/dispute-intent", body);
}
