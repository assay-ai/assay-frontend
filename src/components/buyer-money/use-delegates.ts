"use client";

import { useQuery } from "@tanstack/react-query";

import { escrowKeys } from "@/features/escrow/query-keys";
import { listDelegates } from "@/services/delegation.service";

/**
 * `GET /escrow/delegates`, one query for the whole app: the agents' readiness,
 * the payer's grants panel, the revoke and authorise sheets and the
 * enable-paid page all read this key, so one request answers them and one
 * poll keeps them all current (React Query runs the observers' polls against
 * the one query).
 *
 * `fresh`: a sheet that must not act on a list from before it opened reads it
 * again on mount, whatever its age.
 */
export function useDelegatesQuery(options: { enabled?: boolean; pollMs?: number | false; fresh?: boolean } = {}) {
  return useQuery({
    queryKey: escrowKeys.delegates,
    queryFn: listDelegates,
    enabled: options.enabled ?? true,
    retry: 0,
    refetchInterval: options.pollMs ?? false,
    ...(options.fresh ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
}
