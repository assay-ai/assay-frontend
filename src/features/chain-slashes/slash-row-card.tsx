"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { stampUtc } from "@/features/g34a/stats";
import { formatRemaining } from "@/hooks/useCountdown";
import {
  explorerAddressLink,
  explorerTxLink,
  type StakeDeployment,
} from "@/libs/chains/evm/stake-slashes/deployments";
import type { AssetMeta } from "@/libs/chains/evm/stake-slashes/load";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import type { SlashStatusKey } from "@/libs/chains/evm/stake-slashes/status";
import { shortAddress } from "@/libs/chains/format";
import { cn } from "@/utils";

import type { AssayMatch } from "./assay-match";
import { CopyValue } from "./copy-value";
import {
  countdownUrgency,
  executableAtLabel,
  formatAtomic,
  isoFromSeconds,
  pendingPhase,
  reservedLabel,
  shortRequestId,
  type CountdownUrgency,
} from "./format";

const STATUS_TONE: Record<SlashStatusKey, string> = {
  pending: "bg-danger-10 text-danger-700",
  disputed: "bg-primary-10 text-primary-700",
  executed: "bg-03 text-02",
  cancelled: "bg-success-10 text-success-700",
  none: "bg-03 text-02",
  unknown: "bg-warning-10 text-warning-700",
};

const URGENCY_TONE: Record<CountdownUrgency, string> = {
  normal: "border-01 bg-02 text-01",
  warning: "border-warning-20 bg-warning-10 text-warning-700",
  danger: "border-danger-20 bg-danger-10 text-danger-700",
};

/**
 * Where to dispute, for a Pending row inside its window. On-chain dispute is
 * not built yet (see `DisputeOnChainSlot`), so the way to dispute is in Assay:
 * from the case page when the row matches a case, otherwise from Disputes or
 * through Assay support.
 */
function HowToDispute({ match }: { match: AssayMatch }) {
  if (match.kind === "known") {
    return (
      <p className="text-body-13 text-02">
        To dispute it, open{" "}
        <Link
          href={`/provider/cases/${encodeURIComponent(match.proposalId)}`}
          className="text-primary-600 underline"
        >
          its Assay case
        </Link>{" "}
        and dispute it there, or contact Assay support.
      </p>
    );
  }
  return (
    <p className="text-body-13 text-02">
      To dispute it, open the case from your{" "}
      <Link href="/provider/disputes" className="text-primary-600 underline">
        Assay disputes
      </Link>{" "}
      and dispute it from its case page, or contact Assay support.
    </p>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="min-w-0 text-body-13 text-01 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function TxLink({ deployment, hash, label }: { deployment: StakeDeployment; hash: string | null; label: string }) {
  if (!hash) return null;
  const href = explorerTxLink(deployment, hash);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-label-13 text-primary-600 hover:underline"
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function AssayMatchTag({ match }: { match: AssayMatch }) {
  if (match.kind === "known") {
    return (
      <Link
        href={`/provider/cases/${encodeURIComponent(match.proposalId)}`}
        className="text-label-13 text-primary-600 hover:underline"
      >
        Open Assay case
      </Link>
    );
  }
  if (match.kind === "not-known") {
    return (
      <span
        className="inline-flex items-center whitespace-nowrap rounded-full bg-danger-10 px-[9px] py-1 font-mono text-mono-xs font-semibold text-danger-700"
        title="Assay has no case for this penalty. If Assay did not decide it, it may be forged — dispute it before the timer ends."
      >
        NOT KNOWN TO ASSAY
      </span>
    );
  }
  return null;
}

/**
 * ─── DISPUTE ON CHAIN: RESERVED SLOT ─────────────────────────────────────────
 *
 * NOT BUILT IN THIS TASK. The contract's `disputeSlash(requestId)` is being
 * added in parallel; until its ABI is deployed this renders nothing.
 *
 * To build it: render a button here when `canDisputeOnChain` is true (a
 * Pending row inside its 72h window, and the page is checking the signed-in
 * provider's own stake wallet, not a pasted address). On click, sign and send
 * `disputeSlash(row.requestId)` to `deployment.stakeContract` from that wallet
 * (`useSigner({ chainId: deployment.chainId, address: provider })`), then
 * refetch the page's query so the row reads "Disputed" from `slashRecordOf`.
 */
function DisputeOnChainSlot(_props: {
  row: ChainSlashRow;
  deployment: StakeDeployment;
  canDisputeOnChain: boolean;
}) {
  return null;
}

export function SlashRowCard({
  row,
  deployment,
  asset,
  nowSeconds,
  match,
  viewingOwnStake,
}: {
  row: ChainSlashRow;
  deployment: StakeDeployment;
  asset: AssetMeta;
  nowSeconds: number;
  match: AssayMatch;
  viewingOwnStake: boolean;
}) {
  const money = (amount: bigint) => formatAtomic(amount, asset.decimals, asset.symbol);
  const phase = pendingPhase(row, nowSeconds);
  const beneficiaryHref = explorerAddressLink(deployment, row.beneficiary);

  return (
    <li
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-01 p-4",
        match.kind === "not-known" ? "border-danger-20" : "border-01",
      )}
    >
      {/* Status, id, Assay match */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold uppercase tracking-[0.6px]",
            STATUS_TONE[row.status.key],
          )}
        >
          {row.status.label}
        </span>
        <CopyValue
          value={row.requestId}
          display={shortRequestId(row.requestId)}
          label="request id"
          className="text-mono-13 text-02"
        />
        <span className="ml-auto">
          <AssayMatchTag match={match} />
        </span>
      </div>

      {row.cancelReason ? <p className="text-body-13 text-02">{row.cancelReason}</p> : null}

      {/* The clock, while it matters */}
      {phase?.phase === "disputable" ? (
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-body-13",
              URGENCY_TONE[countdownUrgency(phase.secondsLeft)],
            )}
          >
            <span className="font-semibold">{formatRemaining(phase.secondsLeft * 1000)}</span> left to
            dispute. Dispute before{" "}
            <span className="font-mono font-semibold">
              {stampUtc(isoFromSeconds(row.executableAt))} UTC
            </span>
            ; from then on anyone can execute it and the penalty is taken from your stake.
          </p>
          <HowToDispute match={match} />
        </div>
      ) : phase?.phase === "executable" ? (
        <p className="text-body-13 text-danger-700">
          The dispute window has closed. This penalty can be executed now; if nobody executes it in
          the next {formatRemaining(phase.secondsLeft * 1000)}, it expires and the stake is released.
        </p>
      ) : phase?.phase === "expirable" ? (
        <p className="text-body-13 text-02">
          Nobody executed this in time. It can no longer be executed, only expired, which releases
          the reserved stake.
        </p>
      ) : null}

      <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-2.5 min-[480px]:grid-cols-2 tablet:grid-cols-3">
        <Fact label="Penalty">
          <span className="font-mono">{money(row.penalty)}</span>
        </Fact>
        <Fact label={reservedLabel(row.status.key)}>
          <span className="font-mono">{money(row.reserved)}</span>
        </Fact>
        <Fact label="Applied">
          <span className="font-mono">{row.applied === null ? "Not taken" : money(row.applied)}</span>
        </Fact>
        <Fact label="Beneficiary">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CopyValue
              value={row.beneficiary}
              display={shortAddress(deployment.chainId, row.beneficiary)}
              label="beneficiary address"
            />
            {beneficiaryHref ? (
              <a
                href={beneficiaryHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open beneficiary in the block explorer"
                className="text-03 hover:text-01"
              >
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
          </span>
        </Fact>
        <Fact label="Proposed">
          <span className="font-mono">{stampUtc(isoFromSeconds(row.proposedAt))} UTC</span>
        </Fact>
        <Fact label={executableAtLabel(row, nowSeconds)}>
          <span className="font-mono">{stampUtc(isoFromSeconds(row.executableAt))} UTC</span>
        </Fact>
      </dl>

      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5">
        <TxLink deployment={deployment} hash={row.proposeTx} label="Proposal tx" />
        <TxLink
          deployment={deployment}
          hash={row.closeTx}
          label={row.status.key === "cancelled" ? "Cancel tx" : "Execution tx"}
        />
        {row.stateSource === "events" ? (
          <span className="text-body-xs text-03">
            Current state could not be read; shown from the contract&apos;s events.
          </span>
        ) : null}
      </div>

      <DisputeOnChainSlot
        row={row}
        deployment={deployment}
        canDisputeOnChain={viewingOwnStake && phase?.phase === "disputable"}
      />
    </li>
  );
}
