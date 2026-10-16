"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/libs/ApiClient";
import { getApprovedArbiterBlockCall, listApprovals } from "@/services/operator.service";

import {
  APPROVED_BLOCKS_QUERY,
  approvedArbiterBlocks,
  arbiterErrorMessage,
  type ApprovedArbiterBlock,
} from "./arbiter";
import { chainDisplayName } from "./call-summary";
import { ContractCallAction } from "./contract-call-action";
import { useOperatorDirectory } from "./use-operator-lookups";

/**
 * Approved on-chain blocks (A-11) the arbiter's wallet may still have to sign
 * (frontend review N5). The approval's unsigned `setBlocked` used to live only
 * in the approver's tab; here each approved block's call is fetched again,
 * rebuilt by the backend from the approved payload, and signed or copied
 * through the same guarded panel. The backend refuses it (409) once the
 * address is blocked on chain, once the approval is older than the
 * approvals' expiry, and once the block was carried out and later lifted
 * (review R2-7). The list is filtered by action on the server.
 *
 * The section shows only when there is a block to sign (or the list failed):
 * no heading and empty sentence on a page that has nothing for it.
 */
export function ApprovedArbiterBlocks({
  onSent,
  canRule = true,
}: {
  onSent?: () => void;
  /**
   * Whether this operator rules as the arbiter (ADJL, TRE). Others allowed to
   * fetch the call (Support, SRE) prepare the file for the arbiter's wallet,
   * and the row says so instead of "Sign or download".
   */
  canRule?: boolean;
}) {
  const approvals = useQuery({
    queryKey: ["operator", "approvals", APPROVED_BLOCKS_QUERY.status, APPROVED_BLOCKS_QUERY.action],
    queryFn: () => listApprovals(APPROVED_BLOCKS_QUERY),
    retry: 0,
  });
  const { nameOf } = useOperatorDirectory();
  const blocks = approvedArbiterBlocks(approvals.data?.items ?? []);

  if (approvals.isLoading) return null;
  if (!approvals.isError && blocks.length === 0) return null;
  return (
    <section aria-labelledby="approved-blocks" className="flex w-full flex-col gap-2">
      <h2 id="approved-blocks" className="text-label-13 text-02">
        On-chain blocks to sign{blocks.length > 0 ? <span className="tabular-nums text-03"> · {blocks.length}</span> : null}
      </h2>
      {approvals.isError ? (
        <PageState
          kind="error"
          title="Approved on-chain blocks could not be read"
          description={arbiterErrorMessage(approvals.error, "block").replace(/\s*\([A-Z_]+\)$/, "")}
          onRetry={() => void approvals.refetch()}
          code={approvals.error instanceof ApiError ? approvals.error.code : null}
        />
      ) : (
        <>
          <p className="text-body-xs text-03">
            Approved by a second Lead adjudicator. Nothing is blocked on chain until the arbiter&rsquo;s wallet signs each one.
            {canRule ? null : " You can download each file for the arbiter's wallet; only that wallet can sign it."}
          </p>
          <ul className="flex w-full flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
            {blocks.map((block) => (
              <ApprovedBlockRow
                key={block.approvalId}
                block={block}
                approvedBy={block.approvedBy ? nameOf(block.approvedBy) : null}
                onSent={onSent}
                openLabel={canRule ? "Sign or download" : "Download for the arbiter"}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ApprovedBlockRow({
  block,
  approvedBy,
  onSent,
  openLabel,
}: {
  block: ApprovedArbiterBlock;
  approvedBy: string | null;
  onSent?: () => void;
  openLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const call = useQuery({
    queryKey: ["operator", "arbiter", "approved-block", block.approvalId],
    queryFn: () => getApprovedArbiterBlockCall(block.approvalId),
    enabled: open,
    retry: 0,
  });
  return (
    <li className="flex w-full min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex w-full min-w-0 flex-col gap-2 tablet:flex-row tablet:items-start tablet:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-body-sm font-medium text-01" title={block.account}>
            Block wallet {shortId(block.account)} on chain
          </p>
          <p className="text-body-xs text-03">
            {chainDisplayName(block.chainId)}
            {approvedBy ? ` · approved by ${approvedBy}` : ""}
            {block.decidedAt ? (
              <>
                {" "}
                <UtcTime value={block.decidedAt} midSentence />
              </>
            ) : null}
          </p>
        </div>
        {!open ? (
          <Button type="button" variant="secondary" size="sm" className="touch-target shrink-0 self-start" onClick={() => setOpen(true)}>
            {openLabel}
          </Button>
        ) : null}
      </div>
      {open && call.isLoading ? <p className="text-body-xs text-03">Building the call…</p> : null}
      {open && call.isError ? (
        <p className="text-body-13 text-02" role="alert">
          {arbiterErrorMessage(call.error, "block").replace(/\s*\([A-Z_]+\)$/, "")}
        </p>
      ) : null}
      {call.data ? (
        <ContractCallAction
          call={call.data}
          // The address the approver approved, never the server's label.
          expected={{ contract: "config", functionName: "setBlocked", args: [block.account, true] }}
          signLabel="Sign and send the on-chain block"
          successTitle="Blocked on chain"
          successDescription="The contracts refuse the wallet once this lands. Only the contracts' admin key can lift it on chain."
          afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The contracts refuse the wallet once it lands."
          trackIds={[block.approvalId]}
          onRetry={() => void call.refetch()}
          onSigned={() => onSent?.()}
        />
      ) : null}
    </li>
  );
}
