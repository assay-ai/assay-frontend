"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { listAccountBlocks } from "@/services/operator.service";

import type { ApprovalContext } from "./approvals";
import { eligibleApprovers } from "./inbox";
import { useOperatorDirectory } from "./use-operator-lookups";

/** The API's page ceiling. Enough to name what a pending request is about. */
const LOOKUP_LIMIT = 100;

/**
 * What an approval card needs besides the approval: the block and operator
 * rows its target names, the platform asset (to read limits as money), and
 * who could approve each request. Blocks are read only when a listed request
 * is about one.
 */
export function useApprovalContext(
  rows: readonly OperatorApproval[],
  me: Pick<OperatorIdentity, "authorityLimit">,
): {
  context: ApprovalContext;
  approversFor: (approval: OperatorApproval) => string[] | undefined;
  nameOf: (subject: string | null | undefined) => string;
} {
  const directory = useOperatorDirectory();
  const needsBlocks = rows.some((row) => row.action === "account.unblock");
  const blocksQuery = useQuery({
    queryKey: ["operator", "blocks", "lookup"],
    queryFn: () => listAccountBlocks({ limit: LOOKUP_LIMIT }),
    enabled: needsBlocks,
    retry: 0,
  });

  const context = React.useMemo<ApprovalContext>(() => {
    const operators = directory.operators;
    const withLimit = operators.find((op) => op.authorityLimit !== null)?.authorityLimit ?? me.authorityLimit;
    return {
      blocks: new Map((blocksQuery.data?.items ?? []).map((block) => [block.id, block])),
      operators: new Map(operators.map((op) => [op.id, op])),
      asset: withLimit ? { asset: withLimit.asset, decimals: withLimit.decimals } : null,
    };
  }, [blocksQuery.data, directory.operators, me.authorityLimit]);

  const approversFor = React.useCallback(
    (approval: OperatorApproval) =>
      directory.isPending || directory.isError
        ? undefined
        : eligibleApprovers(approval.code, directory.operators, approval.requestedById),
    [directory.operators, directory.isPending, directory.isError],
  );

  return { context, approversFor, nameOf: directory.nameOf };
}
