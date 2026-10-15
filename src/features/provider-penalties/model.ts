/**
 * Penalties, as the provider reads them: one row per on-chain record (the
 * chain is the source of truth for status, amount and deadlines), decorated
 * with Assay's case (tool, window, failures) when Assay knows it.
 *
 * Tabs:
 *   needs-action   pending on chain (disputable, waiting after an uphold, or
 *                  executable now) — it can still take stake
 *   disputed       disputed on chain, waiting for the arbiter
 *   closed         executed or cancelled (incl. expired)
 */

import type { TimelineStepState } from "@/components/patterns/status-timeline";
import type { AssayCaseIndex } from "@/features/chain-slashes/assay-match";
import type { Money } from "@/interfaces";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import type { SlashStatusKey } from "@/libs/chains/evm/stake-slashes/status";

export type PenaltyTab = "needs-action" | "disputed" | "closed";
export const PENALTY_TABS: readonly { id: PenaltyTab; label: string }[] = [
  { id: "needs-action", label: "Needs action" },
  { id: "disputed", label: "Disputed" },
  { id: "closed", label: "Closed" },
];

export function isPenaltyTab(value: string): value is PenaltyTab {
  return value === "needs-action" || value === "disputed" || value === "closed";
}

/** Business #21: the arbiter aims to rule within 7 days of a dispute. */
export const ARBITER_TARGET_SECONDS = 7 * 86_400;

export type ClosedAs = "executed" | "cancelled" | "expired";

export interface PenaltyRow {
  /** Lower-case on-chain request id. */
  id: string;
  requestId: string;
  proposalId: string | null;
  chainKey: SlashStatusKey;
  tab: PenaltyTab;
  amount: Money;
  /** What an executed penalty actually took. */
  applied: Money | null;
  proposedAt: string;
  /** On-chain `executableAt`: the dispute deadline while pending. */
  executableAt: string;
  disputedAt: string | null;
  /** Disputed: when an unruled dispute can be expired (30 days). */
  disputeExpiresAt: string | null;
  /** Disputed: the arbiter's 7-day target. */
  arbiterTargetAt: string | null;
  upheld: boolean;
  /** Pending, own wallet, before the deadline. */
  canDispute: boolean;
  closedAs: ClosedAs | null;
  closedReason: string | null;
}

const iso = (seconds: number | null | undefined) =>
  seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

export function tabOf(key: SlashStatusKey): PenaltyTab {
  if (key === "disputed") return "disputed";
  if (key === "executed" || key === "cancelled") return "closed";
  return "needs-action";
}

export function penaltyRowOf(
  row: ChainSlashRow,
  asset: { decimals: number; symbol: string },
  index: AssayCaseIndex | null,
  nowSeconds: number,
): PenaltyRow {
  const id = row.requestId.toLowerCase();
  const money = (value: bigint): Money => ({ amount: value.toString(), asset: asset.symbol, decimals: asset.decimals });
  const proposalId = index?.status === "checked" ? (index.known.get(id)?.proposalId ?? null) : null;
  const closedAs: ClosedAs | null =
    row.status.key === "executed"
      ? "executed"
      : row.status.key === "cancelled"
        ? /expired|unresolved/i.test(row.cancelReason ?? "")
          ? "expired"
          : "cancelled"
        : null;
  return {
    id,
    requestId: row.requestId,
    proposalId,
    chainKey: row.status.key,
    tab: tabOf(row.status.key),
    amount: money(row.penalty),
    applied: row.applied === null ? null : money(row.applied),
    proposedAt: iso(row.proposedAt) ?? new Date(0).toISOString(),
    executableAt: iso(row.executableAt) ?? new Date(0).toISOString(),
    disputedAt: iso(row.disputedAt),
    disputeExpiresAt: iso(row.disputeExpiresAt),
    arbiterTargetAt: row.status.key === "disputed" && row.disputedAt ? iso(row.disputedAt + ARBITER_TARGET_SECONDS) : null,
    upheld: row.upheld,
    canDispute: row.status.key === "pending" && nowSeconds < row.executableAt,
    closedAs,
    closedReason: row.cancelReason,
  };
}

/** Soonest deadline first in open tabs; newest first in Closed. */
export function sortPenalties(rows: readonly PenaltyRow[]): PenaltyRow[] {
  return [...rows].sort((a, b) =>
    a.tab === "closed" && b.tab === "closed"
      ? b.proposedAt.localeCompare(a.proposedAt)
      : a.executableAt.localeCompare(b.executableAt),
  );
}

export function countByTab(rows: readonly PenaltyRow[]): Record<PenaltyTab, number> {
  const counts: Record<PenaltyTab, number> = { "needs-action": 0, disputed: 0, closed: 0 };
  for (const row of rows) counts[row.tab] += 1;
  return counts;
}

/** The lifecycle, Proposed → Disputed → Arbiter rules → Executed / Cancelled / Expired. */
export interface PenaltyTimelineStep {
  id: string;
  label: string;
  state: TimelineStepState;
  date: string | null;
  dateLabel?: string;
  countdown?: boolean;
  description?: string;
}

export function penaltyTimeline(row: PenaltyRow): PenaltyTimelineStep[] {
  const disputed = row.disputedAt !== null;
  const closed = row.tab === "closed";
  const steps: PenaltyTimelineStep[] = [
    { id: "proposed", label: "Proposed", state: "done", date: row.proposedAt },
  ];
  steps.push({
    id: "disputed",
    label: "Disputed",
    state: disputed ? "done" : closed || !row.canDispute ? "skipped" : "current",
    date: disputed ? row.disputedAt : row.canDispute ? row.executableAt : null,
    dateLabel: disputed ? undefined : row.canDispute ? "Dispute by" : undefined,
    countdown: !disputed && row.canDispute,
  });
  steps.push({
    id: "ruling",
    label: row.upheld ? "Arbiter upheld it" : "Arbiter rules",
    state: !disputed ? "skipped" : row.chainKey === "disputed" ? "current" : "done",
    date: row.chainKey === "disputed" ? row.arbiterTargetAt : null,
    dateLabel: row.chainKey === "disputed" ? "Target" : undefined,
  });
  const finalLabel =
    row.closedAs === "executed" ? "Executed" : row.closedAs === "expired" ? "Expired" : row.closedAs === "cancelled" ? "Cancelled" : "Executed or cancelled";
  steps.push({
    id: "final",
    label: finalLabel,
    state: closed ? (row.closedAs === "executed" ? "failed" : "done") : "upcoming",
    date: closed ? null : row.chainKey === "disputed" ? null : row.executableAt,
    dateLabel: !closed && row.chainKey !== "disputed" ? "Can execute from" : undefined,
    description: row.closedReason ?? undefined,
  });
  return steps;
}

/**
 * What a provider loses: an executed penalty takes the agent's and the
 * platform's shares (60% + 30% under the current terms); the remaining 10%
 * is never taken. Split exactly as the program does (floors), see
 * `provider-slash-case/distribution.ts`.
 */
export interface PenaltyCase {
  toolName: string | null;
  bindingId: string | null;
  windowLabel: string | null;
  windowId: string | null;
}

export function caseOf(detail: SlashProposalCaseDetail | undefined | null): PenaltyCase {
  const p = detail?.proposal;
  return {
    toolName: p?.toolName ?? null,
    bindingId: p?.bindingId ?? null,
    windowLabel: p?.windowLabel ?? null,
    windowId: p?.windowId ?? null,
  };
}
