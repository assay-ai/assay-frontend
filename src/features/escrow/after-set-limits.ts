import type { QueryClient } from "@tanstack/react-query";

import type { BuyerEscrow, EscrowLimitsBody } from "@/interfaces";
import { getEscrow, revalidateEscrow } from "@/services/escrow.service";

import { limitsLanded } from "./limits-form";

/** The escrow query's key — one entry per `?chain=`, shared with `/funding/escrow`. */
export function escrowQueryKey(chainId: string | null) {
  return ["escrow", chainId] as const;
}

/**
 * The escrow query's `queryFn` on the limits screen.
 *
 * While a submitted SetLimits has not shown up in a read yet, every read goes
 * past the browser's HTTP cache. `GET /escrow` is served `private, max-age=10,
 * stale-while-revalidate=3600`, so a plain poll is answered with the pre-write
 * body for ten seconds and then once more from the stale entry — which is how
 * BUG-J-BUY-03 survived the polling fix: the card kept the old figures until a
 * reload.
 */
export function readEscrow(chainId: string | null, awaiting: unknown): Promise<BuyerEscrow> {
  return awaiting ? revalidateEscrow(chainId) : getEscrow(chainId);
}

/**
 * What a successful SetLimits does to the cache, in one place.
 *
 * - Every escrow entry is marked stale without refetching: an `invalidateQueries`
 *   refetch would go through the screen's current `queryFn`, which at that
 *   moment is still the plain HTTP-cached GET, and it would overwrite a fresh
 *   seed with the pre-write body.
 * - When the relayer's own post-transaction read already shows the signed
 *   limits, it IS the escrow — seed this chain's entry with it.
 * - Otherwise re-read this chain's entry past the HTTP cache. If that read is
 *   still behind (an RPC a block behind the receipt), the screen's
 *   `limitsLandingInterval` keeps polling through `readEscrow`.
 */
export async function applyLimitsSubmitted(
  queryClient: QueryClient,
  chainId: string | null,
  signed: EscrowLimitsBody,
  relayedEscrow: BuyerEscrow | null | undefined,
): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: ["escrow"], refetchType: "none" });
  if (relayedEscrow && limitsLanded(relayedEscrow, signed)) {
    queryClient.setQueryData(escrowQueryKey(chainId), relayedEscrow);
    return;
  }
  await queryClient
    .fetchQuery({
      queryKey: escrowQueryKey(chainId),
      queryFn: () => revalidateEscrow(chainId),
      staleTime: 0,
    })
    .catch(() => undefined);
}
