import { queryOptions } from "@tanstack/react-query";

import { listOperatorToolRequests, listOperatorTools } from "@/services/operator-contracts.service";
import {
  getArbiterTerms,
  getOperatorCase,
  getOperatorDashboardData,
  getPlatformHealth,
  listAccountBlocks,
  listApprovals,
  listArbiterDisputes,
} from "@/services/operator.service";

/**
 * The operator console's shared reads: one key, one request and one freshness
 * per endpoint, whichever screens read it. A screen adds what is its own
 * (`enabled`, `select`, the poll it needs while it is open) on top.
 *
 * Freshness comes from the `["operator"]` default in `providers/query-client.ts`
 * (the server keeps operator lists 15-30 s) unless a read below says otherwise.
 */
/** `GET /operator/tools`: what a tool write invalidates. */
export const OPERATOR_TOOLS_LIST_KEY = ["operator", "tools", "list"] as const;

export const operatorQueries = {
  /** Every pending approval (the badge counts them; screens filter their own). */
  pendingApprovals: () =>
    queryOptions({
      queryKey: ["operator", "approvals", "pending-count"],
      queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
      retry: 0,
    }),
  health: () => queryOptions({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, retry: 0 }),
  reconciliation: () =>
    queryOptions({
      queryKey: ["operator", "health", "reconciliation"],
      queryFn: async () => (await getOperatorDashboardData()).reconciliation ?? [],
      retry: 0,
    }),
  arbiterDisputes: () =>
    queryOptions({ queryKey: ["operator", "arbiter", "disputes"], queryFn: listArbiterDisputes, retry: 0 }),
  toolRequests: () =>
    queryOptions({ queryKey: ["operator", "tool-requests"], queryFn: () => listOperatorToolRequests(), retry: 0 }),
  /**
   * Every tool, for names: a minute fresh, names do not move faster. The tools
   * page and the contract editor read it again on every visit
   * (`refetchOnMount: "always"`), and a tool write invalidates it
   * (`OPERATOR_TOOLS_LIST_KEY`).
   */
  tools: () => queryOptions({ queryKey: OPERATOR_TOOLS_LIST_KEY, queryFn: listOperatorTools, staleTime: 60_000, retry: 0 }),
  case: (proposalId: string) =>
    queryOptions({ queryKey: ["operator", "case", proposalId], queryFn: () => getOperatorCase(proposalId), retry: 0 }),
  /**
   * The arbiter and its terms on a chain. Read from the chain, which the API
   * does not cache, and changed by a contracts write: never fresh, so the
   * arbiter page and a ruling sheet read the arbiter as it is now.
   */
  arbiterTerms: (chainId: string) =>
    queryOptions({
      queryKey: ["operator", "arbiter", "terms", chainId],
      queryFn: () => getArbiterTerms(chainId),
      staleTime: 0,
      retry: 0,
    }),
  /** Every account block, for naming one in an approval or the activity log. */
  blocksLookup: () =>
    queryOptions({
      queryKey: ["operator", "blocks", "lookup"],
      queryFn: () => listAccountBlocks({ limit: 100 }),
      staleTime: 60_000,
      retry: 0,
    }),
};
