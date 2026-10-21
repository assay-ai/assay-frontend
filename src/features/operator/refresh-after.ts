import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * What an operator write changes, as query-key prefixes, so the refetch after
 * it covers that and not the whole console.
 *
 * `invalidateQueries({ queryKey: ["operator"] })` refetched every active
 * operator query: the shell's identity, directory and every badge poll as
 * well as the page. Only active queries refetch on an invalidation; the rest
 * are marked stale and every operator query has `staleTime` 0 or a short one,
 * so a screen opened later reads afresh anyway. Each list below is what the
 * backend service behind the write touches. A write that can run any queued
 * action (approving a request) still refreshes the whole console.
 */

/**
 * A tool contract write: save + publish a version (P-10), make a version the
 * default (P-11), deprecate a major. `OperatorContractsService` changes the
 * tool and its versions, records the override, and queues the two-person ones.
 */
export const AFTER_CONTRACT_WRITE: readonly QueryKey[] = [
  ["operator", "tools"],
  ["operator", "approvals"],
  ["operator", "override-log"],
];

/**
 * Lifting an account block (A-10, two-person). `OperatorAccountBlockService`
 * marks the block lifted, records the override, and queues it when a second
 * operator must approve.
 */
export const AFTER_BLOCK_LIFT: readonly QueryKey[] = [
  ["operator", "blocks"],
  ["operator", "approvals"],
  ["operator", "override-log"],
];

export function refreshAfter(queryClient: QueryClient, keys: readonly QueryKey[]): void {
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
}
