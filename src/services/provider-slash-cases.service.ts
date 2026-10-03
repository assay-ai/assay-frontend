import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";

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
