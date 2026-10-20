"use client";

import { useQuery } from "@tanstack/react-query";

import type { OperatorIdentity } from "@/interfaces/operator";
import { listCutoffs } from "@/services/operator-provider-tools.service";

import type { ToolWork } from "./inbox";
import { mayConfirmCutoffs, mayDecideCallDisputes, mayReviewTools } from "./provider-tool-review";
import { operatorQueries } from "@/features/operator/queries";

/**
 * The provider tool reviews, open call disputes and provider-tool takedowns
 * waiting for this operator. Reviews and disputes are the server's own counts
 * (`GET /operator/health`: pendingToolReviews, openCallDisputes), so Home,
 * the nav badge and the queues agree; each counts only for a role that
 * decides it. Takedowns count those a different operator took down.
 * `readOnly` carries the counts a role can see but not decide.
 */
export function useToolWork(identity: Pick<OperatorIdentity, "roles" | "id"> | null | undefined, enabled = true) {
  const health = useQuery({
    ...operatorQueries.health(),
    enabled: enabled && Boolean(identity),
    refetchInterval: 60_000,
    retry: 0,
  });
  const confirms = Boolean(identity && mayConfirmCutoffs(identity.roles));
  const cutoffs = useQuery({
    queryKey: ["operator", "cutoffs", "TOOL", "pending"],
    queryFn: () => listCutoffs({ pending: true, targetType: "TOOL" }),
    enabled: enabled && confirms,
    refetchInterval: 60_000,
    retry: 0,
  });
  const reviews = health.data?.pendingToolReviews ?? 0;
  const calls = health.data?.openCallDisputes ?? 0;
  const decidesReviews = Boolean(identity && mayReviewTools(identity.roles));
  const decidesCalls = Boolean(identity && mayDecideCallDisputes(identity.roles));
  const work: ToolWork = {
    reviews: decidesReviews ? reviews : 0,
    callDisputes: decidesCalls ? calls : 0,
    takedowns: confirms ? (cutoffs.data ?? []).filter((c) => c.actedBy !== identity?.id && !c.confirmedAt && !c.revertedAt).length : 0,
  };
  const readOnly = { reviews: decidesReviews ? 0 : reviews, callDisputes: decidesCalls ? 0 : calls };
  return { work, readOnly, isFetching: health.isFetching || cutoffs.isFetching, dataUpdatedAt: Math.max(health.dataUpdatedAt, cutoffs.dataUpdatedAt) };
}
