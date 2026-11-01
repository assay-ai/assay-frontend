"use client";

import { useQuery } from "@tanstack/react-query";

import { getEscrowUnsettled } from "@/services/delegation.service";

/**
 * `GET /escrow/unsettled` for Funding and the Withdraw sheet: payments that
 * passed and are not settled on chain yet. Shares the caps sheet's cache key.
 * `data.unsettled` null (or a failed read) is unknown, not none: callers then
 * leave the line out rather than say "nothing pending".
 */
export function useEscrowUnsettled(enabled: boolean) {
  return useQuery({
    queryKey: ["escrow-unsettled", null],
    enabled,
    retry: 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => getEscrowUnsettled(Date.now()),
  });
}
