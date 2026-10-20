import type { QueryClient } from "@tanstack/react-query";

import type { BuyerEscrow, EscrowLimitsBody } from "@/interfaces";
import { getEscrow, revalidateEscrow } from "@/services/escrow.service";

import { limitsLanded, limitsLandingInterval } from "./limits-form";

/** The escrow query's key — one entry per `?chain=`, shared with the Funding page's escrow drawer. */
export function escrowQueryKey(chainId: string | null) {
  return ["escrow", chainId] as const;
}

/**
 * The escrow query's `queryFn` on a screen waiting for a SetLimits to show.
 *
 * Both branches are a plain GET now: `GET /escrow` is served
 * `private, no-cache` (BUG-SYS-01), so the browser revalidates every read.
 * When it was served `max-age=10, stale-while-revalidate=3600`, a plain poll
 * was answered with the pre-write body for ten seconds and then once more from
 * the stale entry — which is how BUG-J-BUY-03 survived the polling fix.
 */
export function readEscrow(chainId: string | null, awaiting: unknown): Promise<BuyerEscrow> {
  return awaiting ? revalidateEscrow(chainId) : getEscrow(chainId);
}

/**
 * What a successful SetLimits does to the cache, in one place.
 *
 * - Every escrow entry is marked stale without refetching: a refetch started
 *   now could land after, and overwrite, the fresher read below.
 * - When the relayer's own post-transaction read already shows the signed
 *   limits, it IS the escrow: this chain's entry is seeded with it and
 *   nothing is fetched for it. This is the usual case.
 * - Otherwise this chain's entry is re-read once, awaited. If that read is
 *   still behind (an RPC a block behind the receipt), it keeps being re-read
 *   every `LIMITS_LANDING_POLL_MS` until it shows the signed limits, for at
 *   most `LIMITS_LANDING_TIMEOUT_MS`, without holding up the caller, and
 *   never past a change of signed-in identity (`stopLimitsRereads`).
 * - Once this chain's entry shows them (or the wait ran out), the other escrow
 *   reads on screen (the same escrow under its chain id, say) are refetched
 *   once.
 *
 * A caller must not invalidate `["escrow"]` after this: that refetches the
 * entry just seeded, which is the request this saves, and can paint a read
 * that is still behind over the fresh one.
 */
export async function applyLimitsSubmitted(
  queryClient: QueryClient,
  chainId: string | null,
  signed: EscrowLimitsBody,
  relayedEscrow: BuyerEscrow | null | undefined,
  now: () => number = Date.now,
): Promise<void> {
  const key = escrowQueryKey(chainId);
  void queryClient.invalidateQueries({ queryKey: ["escrow"], refetchType: "none" });
  if (relayedEscrow && limitsLanded(relayedEscrow, signed)) {
    queryClient.setQueryData(key, relayedEscrow);
    refreshOtherEscrowReads(queryClient, key);
    return;
  }
  const awaiting = { body: signed, since: now() };
  const read = await reread(queryClient, chainId);
  if (limitsLanded(read, signed)) {
    refreshOtherEscrowReads(queryClient, key);
    return;
  }
  void keepRereading(queryClient, chainId, awaiting, read, now);
}

/** Bumped by `stopLimitsRereads`; a re-read loop started under another value stops. */
let generation = 0;

/**
 * Ends every background re-read `applyLimitsSubmitted` started. Called when
 * the signed-in identity changes: the limits it waits for are the previous
 * person's, and nothing the next person sees should keep it reading.
 */
export function stopLimitsRereads(): void {
  generation += 1;
}

async function reread(queryClient: QueryClient, chainId: string | null): Promise<BuyerEscrow | undefined> {
  return queryClient
    .fetchQuery({ queryKey: escrowQueryKey(chainId), queryFn: () => revalidateEscrow(chainId), staleTime: 0 })
    .catch(() => undefined);
}

async function keepRereading(
  queryClient: QueryClient,
  chainId: string | null,
  awaiting: { body: EscrowLimitsBody; since: number },
  last: BuyerEscrow | undefined,
  now: () => number,
): Promise<void> {
  const started = generation;
  let read = last;
  for (;;) {
    const wait = limitsLandingInterval(read, awaiting, now());
    if (wait === false) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (generation !== started) return;
    read = await reread(queryClient, chainId);
  }
  if (generation !== started) return;
  refreshOtherEscrowReads(queryClient, escrowQueryKey(chainId));
}

function refreshOtherEscrowReads(queryClient: QueryClient, seeded: ReturnType<typeof escrowQueryKey>): void {
  void queryClient.invalidateQueries({
    queryKey: ["escrow"],
    predicate: (query) => !(query.queryKey.length === seeded.length && query.queryKey.every((part, i) => part === seeded[i])),
  });
}
