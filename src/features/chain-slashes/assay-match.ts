import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";

/**
 * Does Assay's backend know about this on-chain penalty?
 *
 * The list on this page comes from the chain and never from the backend. The
 * backend is consulted only to ENRICH a row, and the one enrichment that
 * matters is its absence: **a Pending record with no matching case in Assay is
 * the signature of a forged slash** (a leaked verifier key proposing penalties
 * that no Assay process decided). That row is marked "Not known to Assay".
 *
 * ## The gap, stated
 *
 * No provider endpoint returns a case's on-chain request ids today. The
 * backend derives them (`deriveChainRequestId` in
 * `assay-backend/src/modules/slash/services/slash-proposal.service.ts`, and
 * `slashPartRequestId` for pro-rata parts) and keeps them in
 * `slash_proposals.chain_request_id` / `slash_proposal_parts.chain_request_id`,
 * but `SlashProposalCaseDto` does not carry them and there is no list route.
 * They cannot be re-derived here either: a part's id needs the window, the
 * epoch and the agent account.
 *
 * So the production lookup answers `unavailable`, and every row reads
 * "Not checked against Assay" rather than a false "Not known to Assay" on
 * every penalty — an alarm that fires on everything teaches people to ignore
 * it. The matching itself is built and tested; wiring it is replacing
 * `lookupAssayCases` with a call to an endpoint that, given request ids,
 * answers which ones belong to a case of this provider and which case.
 */

export type AssayCaseIndex =
  | {
      readonly status: "checked";
      /** Lower-case request id → the case it belongs to. */
      readonly known: ReadonlyMap<string, { readonly proposalId: string }>;
    }
  | { readonly status: "unavailable"; readonly reason: string };

export type AssayMatch =
  | { readonly kind: "known"; readonly proposalId: string }
  | { readonly kind: "not-known" }
  | { readonly kind: "unchecked" };

export const LOOKUP_UNAVAILABLE_REASON =
  "Assay does not yet publish the on-chain ids of its cases to providers, so these rows could not be matched to a case.";

/**
 * The backend lookup. Answers `unavailable` until an endpoint exists — see the
 * module docstring for what it must return. Kept async so the call site does
 * not change when it is wired.
 */
export async function lookupAssayCases(_requestIds: readonly HexString[]): Promise<AssayCaseIndex> {
  return { status: "unavailable", reason: LOOKUP_UNAVAILABLE_REASON };
}

/**
 * One row's match. Only rows that still need attention can be "not-known": a
 * closed record is history, and the flag is a call to act, not an audit.
 */
export function assayMatchFor(row: ChainSlashRow, index: AssayCaseIndex | null): AssayMatch {
  if (!index || index.status !== "checked") return { kind: "unchecked" };
  const hit = index.known.get(row.requestId.toLowerCase());
  if (hit) return { kind: "known", proposalId: hit.proposalId };
  return row.status.needsAttention ? { kind: "not-known" } : { kind: "unchecked" };
}
