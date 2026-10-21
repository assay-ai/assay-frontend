import type {
  SlashProposalCaseDetail,
  SlashRequestLookup,
} from "@/interfaces/provider-slash-cases";
import type { CursorPage } from "@/interfaces/api";
import type { SlashProposalSummary } from "@/interfaces/provider-disputes";
import type { DisputeSlashRequestsBody, SlashContractCall } from "@/interfaces/slash-dispute";

import { api } from "./api";

/**
 * `GET /providers/me/slash-proposals/:id` — the whole case.
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
 * `GET /providers/me/slash-proposals` — the provider's proposals as Assay
 * records them, newest first (lot 1 B8). `onChain: false` keeps those with no
 * on-chain record yet (chain status NONE or PROPOSING), which the chain-read
 * Penalties list cannot show. An older backend has no such route (404).
 */
export function listSlashProposals(query: {
  onChain?: boolean;
  status?: string[];
  limit?: number;
  cursor?: string;
}): Promise<CursorPage<SlashProposalSummary>> {
  return api.get<CursorPage<SlashProposalSummary>>("/providers/me/slash-proposals", query as Record<string, unknown>);
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
