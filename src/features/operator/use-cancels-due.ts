"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { OperatorCaseListRow } from "@/interfaces/operator";
import { listOperatorToolRequests, type OperatorToolRequestRow } from "@/services/operator-contracts.service";
import { listOperatorCases } from "@/services/operator.service";

import { cancelsDue, overdueToolRequests } from "./inbox";

/**
 * Penalties waiting for the arbiter's cancel signature (`CANCEL_REQUESTED`),
 * from the Penalties list: Home's "Cancels to sign (n, k overdue)" and the
 * nav badge read this one query, so they agree. Only for an operator who gets
 * the cancel signed (Lead adjudicator, Treasury).
 *
 * "Overdue" is judged at the moment the data was fetched (`dataUpdatedAt`),
 * not each caller's own clock, so Home and the badge always agree.
 */
export function useCancelsDue(enabled: boolean): {
  rows: readonly OperatorCaseListRow[];
  count: number;
  overdue: number;
  title: string;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
} {
  const query = useQuery({
    queryKey: ["operator", "cases", "cancels-due"],
    queryFn: () => listOperatorCases({ status: ["CANCEL_REQUESTED"], limit: 100 }),
    enabled,
    refetchInterval: 60_000,
    retry: 0,
  });
  return React.useMemo(() => {
    // Most overdue first: the one anyone may execute soonest.
    const rows = enabled
      ? [...(query.data?.items ?? [])].sort((a, b) => Date.parse(a.nextDeadline ?? "9999") - Date.parse(b.nextDeadline ?? "9999"))
      : [];
    const due = cancelsDue(rows, query.dataUpdatedAt, query.data?.pageInfo.hasMore ?? false);
    return {
      rows,
      ...due,
      isLoading: enabled && query.isLoading,
      isError: enabled && query.isError,
      dataUpdatedAt: query.dataUpdatedAt,
    };
  }, [enabled, query.data, query.isLoading, query.isError, query.dataUpdatedAt]);
}

/**
 * Tool requests past their answer deadline, for an operator who answers them
 * (Support, Business development, Lead adjudicator). The same query (and key)
 * as the Tools page's "Tool requests to decide", so the counts agree.
 */
export function useToolRequestsDue(enabled: boolean): {
  overdue: readonly OperatorToolRequestRow[];
  isLoading: boolean;
  dataUpdatedAt: number;
} {
  const query = useQuery({
    queryKey: ["operator", "tool-requests"],
    queryFn: () => listOperatorToolRequests(),
    enabled,
    refetchInterval: 60_000,
    retry: 0,
  });
  return React.useMemo(
    () => ({
      overdue: enabled ? overdueToolRequests(query.data?.items ?? [], query.dataUpdatedAt) : [],
      isLoading: enabled && query.isLoading,
      dataUpdatedAt: query.dataUpdatedAt,
    }),
    [enabled, query.data, query.isLoading, query.dataUpdatedAt],
  );
}
