import { queryOptions } from "@tanstack/react-query";

import { listOperatorToolRequests, listOperatorTools } from "@/services/operator-contracts.service";
import {
  getArbiterTerms,
  getOperatorCase,
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
export const operatorQueries = {
  /** Every pending approval (the badge counts them; screens filter their own). */
  pendingApprovals: () =>
    queryOptions({
      queryKey: ["operator", "approvals", "pending-count"],
      queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
      retry: 0,
    }),
  health: () => queryOptions({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, retry: 0 }),
  arbiterDisputes: () =>
    queryOptions({ queryKey: ["operator", "arbiter", "disputes"], queryFn: listArbiterDisputes, retry: 0 }),
  toolRequests: () =>
    queryOptions({ queryKey: ["operator", "tool-requests"], queryFn: () => listOperatorToolRequests(), retry: 0 }),
  /** Every tool, for lists and for names: a minute fresh, names do not move faster. */
  tools: () => queryOptions({ queryKey: ["operator", "tools", "list"], queryFn: listOperatorTools, staleTime: 60_000, retry: 0 }),
  case: (proposalId: string) =>
    queryOptions({ queryKey: ["operator", "case", proposalId], queryFn: () => getOperatorCase(proposalId), retry: 0 }),
  /** The arbiter and its terms on a chain: set by a contract change, so five minutes fresh. */
  arbiterTerms: (chainId: string) =>
    queryOptions({
      queryKey: ["operator", "arbiter", "terms", chainId],
      queryFn: () => getArbiterTerms(chainId),
      staleTime: 5 * 60_000,
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
