"use client";

import { useQuery } from "@tanstack/react-query";

import type { Chain, GetChainsResponse } from "@/interfaces/chain";
import { getChains } from "@/services/chains.service";

/**
 * Three states, and the two that are not `ready` carry an EMPTY list.
 *
 * `loading` is not "Solana": seeding the list with anything is the build-time
 * copy this app avoids, one render deep. `error` is not `ready` with
 * zero chains either — "this deployment offers nothing" and "we could not ask"
 * need opposite screens, and only one of them has a retry.
 */
export type UseChainsResult =
  | { readonly status: "loading"; readonly chains: readonly Chain[] }
  | { readonly status: "error"; readonly chains: readonly Chain[] }
  | { readonly status: "ready"; readonly chains: readonly Chain[] };

const NONE: readonly Chain[] = [];

/**
 * Pure, and exported so the three states are tested without mounting React
 * Query. The hook below is then two lines and has nothing left to get wrong.
 */
export function toChainsResult(query: {
  isPending: boolean;
  isError: boolean;
  data: GetChainsResponse | undefined;
}): UseChainsResult {
  if (query.isError) return { status: "error", chains: NONE };
  if (query.isPending || query.data === undefined) return { status: "loading", chains: NONE };
  return { status: "ready", chains: query.data.chains };
}

/**
 * The one reader of the enabled set.
 *
 * `staleTime` is deliberately short and there is no `gcTime` extension: the
 * route already declares `max-age=60, must-revalidate` with no stale window,
 * and a long client-side stale window would reintroduce through React Query
 * exactly the copy the cache headers were tightened to remove.
 */
export function useChains(): UseChainsResult {
  const query = useQuery<GetChainsResponse>({
    queryKey: ["chains"],
    queryFn: getChains,
    staleTime: 60_000,
    retry: 0,
    networkMode: "always" as const,
  });
  return toChainsResult(query);
}
