"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { stampUtc } from "@/features/g34a/stats";
import { getApprovedArbiterBlockCall, listApprovals } from "@/services/operator.service";

import {
  APPROVED_BLOCKS_QUERY,
  approvedArbiterBlocks,
  arbiterErrorMessage,
  type ApprovedArbiterBlock,
} from "./arbiter";
import { ContractCallAction } from "./contract-call-action";

/**
 * Approved on-chain blocks (A-11) the arbiter's wallet may still have to sign
 * (frontend review N5). The approval's unsigned `setBlocked` used to live only
 * in the approver's tab; here each approved block's call is fetched again,
 * rebuilt by the backend from the approved payload, and signed or copied
 * through the same guarded panel. The backend refuses it (409) once the
 * address is blocked on chain, once the approval is older than the
 * approvals' expiry, and once the block was carried out and later lifted
 * (review R2-7). The list is filtered by action on the server.
 */
export function ApprovedArbiterBlocks({ onSent }: { onSent?: () => void }) {
  const approvals = useQuery({
    queryKey: ["operator", "approvals", APPROVED_BLOCKS_QUERY.status, APPROVED_BLOCKS_QUERY.action],
    queryFn: () => listApprovals(APPROVED_BLOCKS_QUERY),
    retry: 0,
  });
  const blocks = approvedArbiterBlocks(approvals.data?.items ?? []);

  if (approvals.isLoading) return <p className="text-body-xs text-03">Reading approved blocks…</p>;
  if (approvals.isError) {
    return (
      <p className="text-body-13 text-danger-600" role="alert">
        {arbiterErrorMessage(approvals.error, "block")}
      </p>
    );
  }
  if (blocks.length === 0) {
    return <p className="text-body-13 text-02">No approved on-chain block is waiting for the arbiter.</p>;
  }
  return (
    <ul className="flex w-full flex-col gap-3">
      {blocks.map((block) => (
        <ApprovedBlockRow key={block.approvalId} block={block} onSent={onSent} />
      ))}
    </ul>
  );
}

function ApprovedBlockRow({ block, onSent }: { block: ApprovedArbiterBlock; onSent?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const call = useQuery({
    queryKey: ["operator", "arbiter", "approved-block", block.approvalId],
    queryFn: () => getApprovedArbiterBlockCall(block.approvalId),
    enabled: open,
    retry: 0,
  });
  return (
    <li className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-01 bg-01 p-3">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="break-all font-mono text-mono-13 text-01">{block.account}</span>
        <span className="text-body-xs text-03">
          {block.chainId}
          {block.approvedBy ? ` · approved by ${block.approvedBy}` : ""}
          {block.decidedAt ? ` · ${stampUtc(block.decidedAt)} UTC` : ""}
        </span>
        {!open ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Show the unsigned call
          </Button>
        ) : null}
      </div>
      {open && call.isLoading ? <p className="text-body-xs text-03">Building the call…</p> : null}
      {open && call.isError ? (
        <p className="text-body-13 text-02" role="alert">
          {arbiterErrorMessage(call.error, "block")}
        </p>
      ) : null}
      {call.data ? (
        <ContractCallAction
          call={call.data}
          // The address the approver approved, never the server's label.
          expected={{ contract: "config", functionName: "setBlocked", args: [block.account, true] }}
          signLabel="Sign and send the on-chain block"
          successTitle="Blocked on chain"
          successDescription="The contracts refuse the wallet once this lands. Only the admin can lift it."
          afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The contracts refuse the wallet once it lands."
          onSigned={() => onSent?.()}
        />
      ) : null}
    </li>
  );
}
