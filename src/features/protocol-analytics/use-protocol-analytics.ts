"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getProtocolAnalytics,
  type AnalyticsRange,
} from "@/services/protocol-analytics.service";

export function useProtocolAnalytics(range: AnalyticsRange, asset?: string) {
  return useQuery({
    queryKey: ["public", "protocol-analytics", range, asset ?? "default"],
    queryFn: () => getProtocolAnalytics(range, asset),
    staleTime: 0,
    refetchInterval: (query) => (query.state.error ? false : 3_000),
    refetchOnWindowFocus: true,
    retry: false,
    // An asset/range change must not keep displaying the previous selection's figures.
    placeholderData: undefined,
  });
}
