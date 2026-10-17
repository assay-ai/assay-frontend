"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { getOperatorTool } from "@/services/operator-contracts.service";
import { listAccountBlocks } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { approvalTargetId, type ApprovalContext, type ApprovalToolInfo } from "./approvals";
import { eligibleApprovers } from "./inbox";
import { useOperatorDirectory, usePenaltyBriefs, usePenaltyNames, useProviderNames } from "./use-operator-lookups";

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

  const penaltyIds = React.useMemo(
    () => rows.filter((row) => row.action.startsWith("slash.")).map((row) => approvalTargetId(row)),
    [rows],
  );
  const penalties = usePenaltyNames(penaltyIds);
  const penaltiesKey = [...penalties.entries()].map(([id, name]) => `${id}=${name}`).join("|");
  // The same cached reads, with provider and amount apart for the confirm's money line.
  const briefs = usePenaltyBriefs(penaltyIds);
  const providers = useProviderNames();

  // Contract requests name their tool and version: read each tool once.
  const toolIds = React.useMemo(
    () => [...new Set(rows.filter((row) => row.target.startsWith("tool:")).map((row) => approvalTargetId(row)))],
    [rows],
  );
  const toolQueries = useQueries({
    queries: toolIds.map((id) => ({ queryKey: ["operator", "tools", id], queryFn: () => getOperatorTool(id), retry: 0, staleTime: 30_000 })),
  });
  const toolsKey = toolQueries.map((q) => q.dataUpdatedAt).join("|");
  const penaltyParts = new Map<string, { provider: string; amount: string }>();
  briefs.forEach((brief, id) => {
    const proposal = brief.case.proposal;
    penaltyParts.set(id, { provider: providers.name(proposal.providerId), amount: formatMoney(proposal.penaltyAmount) });
  });

  const context = React.useMemo<ApprovalContext>(() => {
    const operators = directory.operators;
    const withLimit = operators.find((op) => op.authorityLimit !== null)?.authorityLimit ?? me.authorityLimit;
    return {
      blocks: new Map((blocksQuery.data?.items ?? []).map((block) => [block.id, block])),
      operators: new Map(operators.map((op) => [op.id, op])),
      asset: withLimit ? { asset: withLimit.asset, decimals: withLimit.decimals } : null,
      penalties,
      penaltyParts,
      tools: toolInfo(toolQueries.map((q) => q.data)),
    };
    // `penalties` is rebuilt every render; its content is `penaltiesKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksQuery.data, directory.operators, me.authorityLimit, penaltiesKey, toolsKey]);

  const approversFor = React.useCallback(
    (approval: OperatorApproval) =>
      directory.isPending || directory.isError
        ? undefined
        : eligibleApprovers(approval.code, directory.operators, approval.requestedById),
    [directory.operators, directory.isPending, directory.isError],
  );

  return { context, approversFor, nameOf: directory.nameOf };
}

function toolInfo(tools: readonly (Awaited<ReturnType<typeof getOperatorTool>> | undefined)[]): Map<string, ApprovalToolInfo> {
  const map = new Map<string, ApprovalToolInfo>();
  for (const tool of tools) {
    if (!tool) continue;
    const semvers = new Map(tool.versions.map((v) => [v.version, v.semver] as const));
    if (tool.draft) semvers.set(tool.draft.version, tool.draft.nextSemver);
    map.set(tool.id, { name: tool.name, semvers, draft: tool.draft ? { version: tool.draft.version, bump: tool.draft.bump } : null });
  }
  return map;
}
