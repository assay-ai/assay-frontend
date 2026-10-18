"use client";

import { useQuery } from "@tanstack/react-query";

import type { OperatorIdentity } from "@/interfaces/operator";
import { listOperatorCallDisputes } from "@/services/operator-call-disputes.service";
import { listProviderToolReviews } from "@/services/operator-provider-tools.service";

import type { ToolWork } from "./inbox";
import { mayDecideCallDisputes, mayReviewTools } from "./provider-tool-review";

/**
 * The provider tool reviews and open call disputes that wait for this
 * operator — read only for a role that decides them, with the same keys as
 * the Reviews and Call disputes pages, so the badge, Home and those pages
 * agree. One page each (the queues are small; a full page reads as "50+").
 */
export function useToolWork(identity: Pick<OperatorIdentity, "roles"> | null | undefined, enabled = true) {
  const reviews = useQuery({
    queryKey: ["operator", "reviews", "pending"],
    queryFn: () => listProviderToolReviews(true),
    enabled: enabled && Boolean(identity && mayReviewTools(identity.roles)),
    refetchInterval: 60_000,
    retry: 0,
  });
  const calls = useQuery({
    queryKey: ["operator", "call-disputes", "open", false],
    queryFn: () => listOperatorCallDisputes({ state: ["OPEN"] }),
    enabled: enabled && Boolean(identity && mayDecideCallDisputes(identity.roles)),
    refetchInterval: 60_000,
    retry: 0,
  });
  const work: ToolWork = {
    reviews: reviews.data ? reviews.data.filter((r) => r.status === "PENDING").length : 0,
    callDisputes: calls.data ? calls.data.items.filter((d) => d.state === "OPEN").length : 0,
  };
  return { work, isFetching: reviews.isFetching || calls.isFetching, dataUpdatedAt: Math.max(reviews.dataUpdatedAt, calls.dataUpdatedAt) };
}
