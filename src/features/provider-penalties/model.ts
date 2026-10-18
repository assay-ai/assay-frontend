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
import { splitPenalty } from "@/features/provider-slash-case/distribution";
import { formatDate } from "@/libs/utc-time";

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
  /**
   * What the chain set aside for it at proposal: the penalty, cut to the
   * chain's limits. Execution applies exactly this (all or wait). Null when the
   * record carries none.
   */
  reserved: Money | null;
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
    reserved: row.reserved > 0n ? money(row.reserved) : null,
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
    // Until the provider disputes, this step is the window to do so, not a dispute.
    label: disputed ? "Disputed" : row.canDispute ? "Dispute window" : "Not disputed",
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
    dateLabel: row.chainKey === "disputed" ? "Aims to rule by" : undefined,
    description: disputed ? undefined : "Only if you dispute",
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
 *
 * The basis is what was applied, else what the chain reserved (execution
 * applies exactly that), else the penalty. Null for a record that took nothing.
 */
export function lossBasis(row: Pick<PenaltyRow, "applied" | "reserved" | "amount">): Money {
  return row.applied ?? row.reserved ?? row.amount;
}

export function lossOf(row: Pick<PenaltyRow, "applied" | "reserved" | "amount" | "closedAs">): Money | null {
  if (row.closedAs === "cancelled" || row.closedAs === "expired") return null;
  return splitPenalty(lossBasis(row)).taken;
}

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

/**
 * Open penalties — every one not closed, whether it still needs the provider
 * or is disputed — and what the stake holds back for them. The Stake page and
 * the Withdraw sheet both say this, so they count the same rows: a disputed
 * penalty still holds its amount until the arbiter rules.
 */
export interface OpenPenaltyHold {
  count: number;
  needsAction: number;
  disputed: number;
  /** Sum of the open amounts, in the first row's asset; null when none are open. */
  total: Money | null;
}

export function openPenaltyHold(rows: readonly PenaltyRow[]): OpenPenaltyHold {
  const open = rows.filter((row) => row.tab !== "closed");
  const first = open[0]?.amount ?? null;
  const total = first
    ? { ...first, amount: open.reduce((sum, row) => sum + BigInt(row.amount.amount || "0"), 0n).toString() }
    : null;
  return {
    count: open.length,
    needsAction: open.filter((row) => row.tab === "needs-action").length,
    disputed: open.filter((row) => row.tab === "disputed").length,
    total,
  };
}

/** "2 open penalties (1 needs your answer, 1 disputed)" — one wording for every screen that counts them. */
export function openPenaltyPhrase(hold: OpenPenaltyHold): string {
  const head = hold.count === 1 ? "1 open penalty" : `${hold.count} open penalties`;
  const parts = [
    hold.needsAction ? `${hold.needsAction} ${hold.needsAction === 1 ? "needs" : "need"} your answer` : null,
    hold.disputed ? `${hold.disputed} disputed` : null,
  ].filter(Boolean);
  return parts.length > 1 ? `${head} (${parts.join(", ")})` : head;
}

/**
 * A penalty's title: the tool and the window it was measured over
 * ("get_weather, Oct 14 – Oct 15"), never an id. Without a tool name it says
 * "Penalty"; without a window, the day it was proposed.
 */
export function penaltyTitle(input: {
  toolName: string | null;
  window: { openedAt: string; closedAt?: string | null; deadlineAt?: string | null } | null;
  proposedAt: string;
  now?: number;
}): string {
  const name = input.toolName ?? "Penalty";
  const options = input.now === undefined ? {} : { now: input.now };
  if (input.window) {
    const start = formatDate(input.window.openedAt, options);
    const endAt = input.window.closedAt ?? input.window.deadlineAt ?? null;
    const end = endAt ? formatDate(endAt, options) : null;
    return `${name}, ${end && end !== start ? `${start} – ${end}` : start}`;
  }
  return `${name}, proposed ${formatDate(input.proposedAt, options)}`;
}
