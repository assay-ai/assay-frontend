"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { ArbiterSupersededRecord } from "@/interfaces/operator";
import { listApprovals, listSupersededRecords } from "@/services/operator.service";

import { APPROVED_BLOCKS_QUERY, approvedArbiterBlocks, type ApprovedArbiterBlock } from "./arbiter";

/**
 * What the arbiter's wallet still has to sign, for Home's "To sign" group and
 * the nav badge (operator review 2026-10-16b, P1-4): approved on-chain blocks
 * (A-11) and superseded records to cancel before anyone may execute them.
 * The same queries (and keys) as the Arbiter page's sections, so the counts
 * never disagree. Only for an operator who rules.
 *
 * [backend] Penalties waiting for a cancel signature (CANCEL_REQUESTED) are
 * not here: no endpoint lists them yet; each shows on its penalty page.
 */
export function useToSign(enabled: boolean): {
  blocks: readonly ApprovedArbiterBlock[];
  superseded: readonly ArbiterSupersededRecord[];
  count: number;
  isLoading: boolean;
} {
  const approved = useQuery({
    queryKey: ["operator", "approvals", APPROVED_BLOCKS_QUERY.status, APPROVED_BLOCKS_QUERY.action],
    queryFn: () => listApprovals(APPROVED_BLOCKS_QUERY),
    enabled,
    refetchInterval: 60_000,
    retry: 0,
  });
  const superseded = useQuery({
    queryKey: ["operator", "arbiter", "superseded"],
    queryFn: listSupersededRecords,
    enabled,
    refetchInterval: 60_000,
    retry: 0,
  });
  return React.useMemo(() => {
    const blocks = enabled ? approvedArbiterBlocks(approved.data?.items ?? []) : [];
    const records = enabled ? (superseded.data ?? []) : [];
    return {
      blocks,
      superseded: records,
      count: blocks.length + records.length,
      isLoading: enabled && (approved.isLoading || superseded.isLoading),
    };
  }, [enabled, approved.data, approved.isLoading, superseded.data, superseded.isLoading]);
}
