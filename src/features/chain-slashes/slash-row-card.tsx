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
import type { NotSelectableReason } from "./dispute-selection";
import {
  countdownUrgency,
  disputedPhase,
  executableAtLabel,
  formatAtomic,
  isoFromSeconds,
  pendingPhase,
  reservedLabel,
  shortRequestId,
  type CountdownUrgency,
} from "./format";
import { routes } from "@/libs/routes";

const STATUS_TONE: Record<SlashStatusKey, string> = {
  pending: "bg-danger-10 text-danger-700",
  upheld: "bg-danger-10 text-danger-700",
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
 * Where to dispute, for a Pending row inside its window. On the provider's own
 * stake wallet the row can be selected and disputed on chain (the checkbox
 * below); the Assay case page and support remain the way when it cannot —
 * a pasted address, or a chain without the dispute upgrade.
 */
function HowToDispute({ match, onChain }: { match: AssayMatch; onChain: boolean }) {
  const lead = onChain
    ? "To dispute it, select it below and choose “Dispute selected on chain”. You can also"
    : "To dispute it,";
  if (match.kind === "known") {
    return (
      <p className="text-body-13 text-02">
        {lead} open{" "}
        <Link
          href={routes.providerCase(match.proposalId)}
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
      {lead} open the case from your{" "}
      <Link href="/provider/disputes" className="text-primary-600 underline">
        Assay disputes
      </Link>{" "}
      and dispute it from its case page, or contact Assay support.
    </p>
  );
}

/**
 * The first sentence on an upheld row: when it was disputed and, if the
 * `SlashUpheld` block time was read, when the arbiter upheld it.
 */
function UpheldLead({ row }: { row: ChainSlashRow }) {
  return (
    <>
      <span className="font-semibold">Upheld by Assay&apos;s arbiter</span>
      {row.upheldAt !== null ? (
        <>
          {" on "}
          <span className="font-mono font-semibold">{stampUtc(isoFromSeconds(row.upheldAt))} UTC</span>
        </>
      ) : null}
      {row.disputedAt !== null
        ? `, after your dispute on ${stampUtc(isoFromSeconds(row.disputedAt))} UTC.`
        : "."}
    </>
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
        href={routes.providerCase(match.proposalId)}
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

/** The per-row half of "Dispute selected on chain"; the button and the send are the page's. */
export interface DisputeSelectionProps {
  /** `null` when the row may be selected; otherwise why it has no checkbox. */
  readonly notSelectable: NotSelectableReason | null;
  readonly selected: boolean;
  /** The 64-row limit is reached and this row is not one of them. */
  readonly limitReached: boolean;
  /** A dispute is being prepared or sent: the selection is frozen. */
  readonly locked: boolean;
  readonly onToggle: () => void;
}

/**
 * DISPUTE ON CHAIN — the row's checkbox, its refusal and its success.
 *
 * Only on the signed-in provider's own stake wallet, only on a Pending row
 * still inside its window (by its own `executableAt`). Selecting is all it
 * does: the page's "Dispute selected on chain" asks the backend for the
 * unsigned `disputeSlashBatch`, and the provider's stake wallet sends it.
 */
function DisputeOnChainSlot({
  row,
  selection,
  refusals,
  justDisputed,
}: {
  row: ChainSlashRow;
  selection: DisputeSelectionProps | null;
  refusals: readonly string[];
  justDisputed: boolean;
}) {
  const id = `dispute-${row.requestId}`;
  const showCheckbox = selection !== null && selection.notSelectable === null && !justDisputed;
  if (!showCheckbox && refusals.length === 0 && !justDisputed) return null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 border-t border-01 pt-3">
      {justDisputed ? (
        <p className="rounded-md border border-primary-20 bg-primary-10 px-3 py-2 text-body-13 text-primary-700" role="status">
          Disputed — awaiting Assay&apos;s arbiter. The penalty cannot be executed while the dispute
          stands.
        </p>
      ) : null}
      {showCheckbox ? (
        <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-label-13 text-01">
          <input
            id={id}
            type="checkbox"
            className="size-4 accent-primary-600"
            checked={selection.selected}
            disabled={selection.locked || (!selection.selected && selection.limitReached)}
            onChange={selection.onToggle}
          />
          Select to dispute on chain
          {!selection.selected && selection.limitReached ? (
            <span className="text-body-xs text-03">(64 selected, the most one transaction takes)</span>
          ) : null}
        </label>
      ) : null}
      {refusals.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-danger-20 bg-danger-10 px-3 py-2" role="alert">
          <p className="text-label-13 text-danger-700">The chain would refuse this one:</p>
          {refusals.map((text) => (
            <p key={text} className="text-body-13 text-danger-700">
              {text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SlashRowCard({
  row,
  deployment,
  asset,
  nowSeconds,
  match,
  viewingOwnStake,
  selection = null,
  refusals = [],
  justDisputed = false,
}: {
  row: ChainSlashRow;
  deployment: StakeDeployment;
  asset: AssetMeta;
  nowSeconds: number;
  match: AssayMatch;
  viewingOwnStake: boolean;
  /** `null` when on-chain dispute is not offered on this page at all. */
  selection?: DisputeSelectionProps | null;
  /** Plain-words reasons the chain would refuse this row in the last attempted dispute. */
  refusals?: readonly string[];
  /** This row was just disputed and the list has not yet read it back as Disputed. */
  justDisputed?: boolean;
}) {
  const money = (amount: bigint) => formatAtomic(amount, asset.decimals, asset.symbol);
  const phase = pendingPhase(row, nowSeconds);
  const dispute = disputedPhase(row, nowSeconds);
  const beneficiaryHref = explorerAddressLink(deployment, row.beneficiary);

  return (
    <li
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-01 p-4",
        selection?.selected ? "border-primary-500" : match.kind === "not-known" ? "border-danger-20" : "border-01",
      )}
    >
      {/* Status, id, Assay match */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex max-w-full items-center rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold uppercase tracking-[0.6px]",
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
          <HowToDispute match={match} onChain={viewingOwnStake && selection !== null} />
        </div>
      ) : phase?.phase === "upheld-waiting" ? (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-body-13",
            URGENCY_TONE[countdownUrgency(phase.secondsLeft)],
          )}
        >
          <UpheldLead row={row} /> A penalty can be disputed on chain only once, so this one cannot
          be disputed again. It can be executed from{" "}
          <span className="font-mono font-semibold">
            {stampUtc(isoFromSeconds(row.executableAt))} UTC
          </span>{" "}
          ({formatRemaining(phase.secondsLeft * 1000)} from now); from then on anyone can execute it
          and the penalty is taken from your stake.
        </p>
      ) : row.status.key === "upheld" && phase?.phase === "executable" ? (
        <p className="text-body-13 text-danger-700">
          <UpheldLead row={row} /> It can be executed now; if nobody executes it in the next{" "}
          {formatRemaining(phase.secondsLeft * 1000)}, it expires and the stake is released.
        </p>
      ) : dispute?.phase === "awaiting-ruling" ? (
        <p className="rounded-md border border-primary-20 bg-primary-10 px-3 py-2 text-body-13 text-primary-700">
          Disputed on{" "}
          <span className="font-mono font-semibold">{stampUtc(isoFromSeconds(row.disputedAt as number))} UTC</span>.
          It cannot be executed while Assay&apos;s arbiter decides. If there is no ruling by{" "}
          <span className="font-mono font-semibold">
            {stampUtc(isoFromSeconds(row.disputeExpiresAt as number))} UTC
          </span>{" "}
          ({formatRemaining(dispute.secondsLeft * 1000)} from now), anyone can expire it and the reserved
          stake is released.
        </p>
      ) : dispute?.phase === "unresolved" ? (
        <p className="text-body-13 text-02">
          Disputed on {stampUtc(isoFromSeconds(row.disputedAt as number))} UTC and not ruled on for 30
          days. It can no longer be upheld, only expired, which releases the reserved stake.
        </p>
      ) : row.status.key === "disputed" ? (
        <p className="text-body-13 text-02">
          Disputed on chain. It cannot be executed while Assay&apos;s arbiter decides; the dispute time
          could not be read.
        </p>
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
          {/* All or wait (assay-evm 9f036a3): an executed penalty takes exactly its reservation. */}
          <span className="font-mono">{row.applied === null ? "Not taken yet" : money(row.applied)}</span>
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
        {row.status.key === "upheld" && row.upheldAt !== null ? (
          <Fact label="Upheld by the arbiter">
            <span className="font-mono">{stampUtc(isoFromSeconds(row.upheldAt))} UTC</span>
          </Fact>
        ) : null}
        {row.disputedAt !== null && row.status.key !== "upheld" ? (
          <Fact label="Disputed on chain">
            <span className="font-mono">{stampUtc(isoFromSeconds(row.disputedAt))} UTC</span>
          </Fact>
        ) : null}
        {row.disputeExpiresAt !== null ? (
          <Fact label="Dispute expires (unruled)">
            <span className="font-mono">{stampUtc(isoFromSeconds(row.disputeExpiresAt))} UTC</span>
          </Fact>
        ) : null}
      </dl>
      {row.upheld && row.status.key !== "disputed" && row.status.key !== "upheld" ? (
        <p className="text-body-13 text-02">
          This penalty was disputed and Assay&apos;s arbiter upheld it. A penalty can be disputed on
          chain only once.
        </p>
      ) : null}

      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5">
        <TxLink deployment={deployment} hash={row.proposeTx} label="Proposal tx" />
        <TxLink deployment={deployment} hash={row.disputeTx} label="Dispute tx" />
        <TxLink deployment={deployment} hash={row.upheldTx} label="Uphold tx" />
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
        selection={selection}
        refusals={refusals}
        justDisputed={justDisputed}
      />
    </li>
  );
}
