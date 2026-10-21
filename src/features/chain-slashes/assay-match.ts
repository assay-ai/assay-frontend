import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import type { SlashRequestLookup } from "@/interfaces/provider-slash-cases";
import {
  SLASH_REQUEST_LOOKUP_MAX,
  lookupSlashRequests,
} from "@/services/provider-slash-cases.service";

/**
 * Does Assay's backend know about this on-chain penalty?
 *
 * The list on this page comes from the chain and never from the backend. The
 * backend is consulted only to ENRICH a row, and the one enrichment that
 * matters is its absence: **a Pending record with no matching case in Assay is
 * the signature of a forged slash** (a leaked verifier key proposing penalties
 * that no Assay process decided). That row is marked "Not known to Assay".
 *
 * ## The lookup
 *
 * `POST /providers/me/slash-requests/lookup {requestIds}` answers which of the
 * ids are a case (or a pro-rata part of a case) of the signed-in provider. It
 * takes at most 200 ids, so the list is sent in chunks of 200. The ids are
 * matched lower-cased on both sides.
 *
 * Any failure — the network, a refusal, a blocked account — answers
 * `unavailable`, and every row then reads "Not checked against Assay" rather
 * than a false "Not known to Assay": an alarm that fires on everything teaches
 * people to ignore it. One failed chunk fails the whole lookup, for the same
 * reason: a partial index would mark the unlooked-up rows as forged.
 *
 * The backend answers for the signed-in provider's own cases, so the page only
 * asks when it shows that provider's own stake wallet — see `useChainSlashes`.
 */

export type AssayCaseIndex =
  | {
      readonly status: "checked";
      /** Lower-case request id → the case it belongs to. */
      readonly known: ReadonlyMap<string, { readonly proposalId: string }>;
    }
  | { readonly status: "unavailable"; readonly reason: string };

export const LOOKUP_UNAVAILABLE_REASON =
  "Assay could not be asked which of these penalties are its cases, so these rows could not be matched to a case.";

/** The most ids one lookup call may carry — the backend's `SLASH_REQUEST_LOOKUP_MAX`. */
export const LOOKUP_CHUNK_SIZE = SLASH_REQUEST_LOOKUP_MAX;

export type SlashRequestLookupFn = (requestIds: readonly string[]) => Promise<SlashRequestLookup>;

/** Splits `items` into runs of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The backend lookup, chunked. `lookup` is injectable for tests; the page uses
 * the real service.
 *
 * Ids are de-duplicated (case-insensitively) before they are chunked, so a
 * list that repeats an id never costs an extra call.
 */
export async function lookupAssayCases(
  requestIds: readonly HexString[],
  lookup: SlashRequestLookupFn = lookupSlashRequests,
): Promise<AssayCaseIndex> {
  const unique = [...new Set(requestIds.map((id) => id.toLowerCase()))];
  const known = new Map<string, { readonly proposalId: string }>();
  if (unique.length === 0) return { status: "checked", known };

  try {
    const answers = await Promise.all(chunk(unique, LOOKUP_CHUNK_SIZE).map((ids) => lookup(ids)));
    for (const answer of answers) {
      for (const match of answer?.matches ?? []) {
        if (typeof match?.requestId !== "string" || typeof match.proposalId !== "string") continue;
        known.set(match.requestId.toLowerCase(), { proposalId: match.proposalId });
      }
    }
  } catch {
    return { status: "unavailable", reason: LOOKUP_UNAVAILABLE_REASON };
  }
  return { status: "checked", known };
}

/**
 * The rows that are records of Assay case `proposalId` — what the case page's
 * "Dispute on chain" opens this page with selected (`?case=`). Empty when the
 * lookup did not answer: a row is never selected on a guess.
 */
export function rowsOfCase(
  rows: readonly ChainSlashRow[],
  index: AssayCaseIndex | null,
  proposalId: string,
): ChainSlashRow[] {
  if (!index || index.status !== "checked") return [];
  return rows.filter((row) => index.known.get(row.requestId.toLowerCase())?.proposalId === proposalId);
}
