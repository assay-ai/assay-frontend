import type { CursorPage } from "@/interfaces/api";
import type {
  CreateDisputeBody,
  Dispute,
  FileSlashDisputeBody,
  ListDisputesQuery,
  SlashProposalCase,
  SlashProposalTimeline,
} from "@/interfaces/provider-disputes";

import { api } from "./api";

/**
 * `GET /disputes` — this organization's own, newest first. Works for every
 * `subjectType`, including the `SLASH_PROPOSAL` one the public enum omits
 * (see `@/interfaces/provider-disputes`'s file header).
 */
export function listDisputes(query: ListDisputesQuery = {}): Promise<CursorPage<Dispute>> {
  return api.get<CursorPage<Dispute>>("/disputes", query as Record<string, unknown>);
}

/**
 * `GET /disputes/:id`. A cross-tenant id and a non-existent one both 404
 * `DISPUTE_NOT_FOUND` (verified on the running API) — "not found" and "not
 * yours" render identically.
 */
export function getDispute(id: string): Promise<Dispute> {
  return api.get<Dispute>(`/disputes/${encodeURIComponent(id)}`);
}

/** `POST /disputes` — the general path. Not used for a slash-proposal objection; see `fileSlashDispute`. */
export function createDispute(body: CreateDisputeBody): Promise<Dispute> {
  return api.post<Dispute>("/disputes", body);
}

/**
 * `GET /providers/me/slash-proposals/:id` — the dispute form's header and prefill.
 * Returns the full `SlashProposalCaseDto`; only the subset in
 * `SlashProposalCase` is typed here (see that interface's docstring).
 */
export function getSlashProposalCase(proposalId: string): Promise<SlashProposalCase> {
  return api.get<SlashProposalCase>(
    `/providers/me/slash-proposals/${encodeURIComponent(proposalId)}`
  );
}

/** `GET /providers/me/slash-proposals/:id/timeline` — the case timeline and restoration record. */
export function getSlashProposalTimeline(proposalId: string): Promise<SlashProposalTimeline> {
  return api.get<SlashProposalTimeline>(
    `/providers/me/slash-proposals/${encodeURIComponent(proposalId)}/timeline`
  );
}

/**
 * `POST /providers/me/slash-proposals/:id/dispute` — the dispute form's submit.
 * Returns the case again, with `proposal.disputeId` now set; navigate to
 * `/provider/disputes/{disputeId}` from that, not from a separate response.
 */
export function fileSlashDispute(
  proposalId: string,
  body: FileSlashDisputeBody
): Promise<SlashProposalCase> {
  return api.post<SlashProposalCase>(
    `/providers/me/slash-proposals/${encodeURIComponent(proposalId)}/dispute`,
    body
  );
}
