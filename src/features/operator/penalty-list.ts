import type { StatusChipKey } from "@/components/patterns/status-chip";
import type { Money } from "@/interfaces/api";
import type {
  AdjudicationQueueRow,
  ArbiterDispute,
  OperatorCaseBrief,
  OperatorCaseListRow,
  OperatorCaseStatus,
} from "@/interfaces/operator";

import { disputeAmount } from "./arbiter";
import { caseFacts, type CaseStage } from "./case-flow";

/**
 * The Penalties list (`/operator/cases`), as data. Pure, so the tabs, the
 * "Next" column and the fallback are tested without the screen.
 *
 * Two sources:
 *  - `GET /operator/cases` (every penalty, by status) when the backend has it;
 *  - otherwise the lists that already exist — disputed on chain, the retired
 *    objection queue, acted on in Activity, and opened in this browser — each
 *    read into the same row, under tabs named for where they came from.
 */

/** One row of the table, whichever source it came from. */
export interface PenaltyRow {
  id: string;
  providerId: string;
  providerName: string;
  toolName: string | null;
  /** Null when the chain's asset is unknown to this build (the amount then reads "—"). */
  amount: Money | null;
  status: OperatorCaseStatus;
  proposedAt: string | null;
  disputedAt: string | null;
  nextDeadline: string | null;
}

export type PenaltyTabId = "needs-ruling" | "signature" | "window" | "executed" | "cancelled" | "all" | "acted" | "recent";

export interface PenaltyTab {
  id: PenaltyTabId;
  label: string;
  /** The statuses asked of `GET /operator/cases`; null for every status. */
  statuses: OperatorCaseStatus[] | null;
}

/** The tabs when the backend lists every penalty. */
export const STATUS_TABS: readonly PenaltyTab[] = [
  // The retired objection process still needs a decision, so its rows sit here too.
  { id: "needs-ruling", label: "Needs ruling", statuses: ["CHAIN_DISPUTED", "DISPUTED"] },
  { id: "signature", label: "Waiting for signature", statuses: ["CANCEL_REQUESTED"] },
  { id: "window", label: "In dispute window", statuses: ["PROPOSED"] },
  { id: "executed", label: "Executed", statuses: ["EXECUTED", "COMPENSATED"] },
  { id: "cancelled", label: "Cancelled", statuses: ["CANCELLED", "EXPIRED"] },
  { id: "all", label: "All", statuses: null },
];

/** Everything still moving: small enough to read whole, so these tabs carry counts. */
export const OPEN_STATUSES: readonly OperatorCaseStatus[] = ["CHAIN_DISPUTED", "DISPUTED", "CANCEL_REQUESTED", "PROPOSED"];

/** The tabs when it does not: named for the source, and only those that have one. */
export const FALLBACK_TABS: readonly PenaltyTab[] = [
  { id: "needs-ruling", label: "Needs ruling", statuses: null },
  { id: "acted", label: "Acted on lately", statuses: null },
  { id: "recent", label: "Opened here", statuses: null },
];

export function tabById(tabs: readonly PenaltyTab[], id: string | null | undefined): PenaltyTab {
  return tabs.find((tab) => tab.id === id) ?? tabs[0]!;
}

/** How many open rows each status tab holds; null for the closed tabs (not counted). */
export function tabCounts(openRows: readonly Pick<PenaltyRow, "status">[]): Partial<Record<PenaltyTabId, number>> {
  const counts: Partial<Record<PenaltyTabId, number>> = {};
  for (const tab of STATUS_TABS) {
    if (!tab.statuses || !tab.statuses.every((s) => OPEN_STATUSES.includes(s))) continue;
    counts[tab.id] = openRows.filter((row) => tab.statuses!.includes(row.status)).length;
  }
  return counts;
}

// ── Reading each source into a row ──────────────────────────────────────────

export function rowFromCase(row: OperatorCaseListRow): PenaltyRow {
  return {
    id: row.proposalId,
    providerId: row.providerId,
    providerName: row.providerName,
    toolName: row.toolName,
    amount: row.amount,
    status: row.status,
    proposedAt: row.proposedAt,
    disputedAt: row.disputedAt,
    nextDeadline: row.nextDeadline,
  };
}

export function rowFromDispute(dispute: ArbiterDispute, providerName: string): PenaltyRow {
  return {
    id: dispute.proposalId,
    providerId: dispute.providerId,
    providerName,
    toolName: null,
    amount: disputeAmount(dispute.chainId, dispute.penaltyAmount),
    status: "CHAIN_DISPUTED",
    proposedAt: null,
    disputedAt: dispute.disputedAt,
    nextDeadline: dispute.expiresAt,
  };
}

export function rowFromQueue(row: AdjudicationQueueRow): PenaltyRow {
  return {
    id: row.proposalId,
    providerId: row.providerId,
    providerName: row.providerName,
    toolName: null,
    amount: row.penaltyAmount,
    status: "DISPUTED",
    proposedAt: null,
    disputedAt: null,
    nextDeadline: row.dueAt,
  };
}

/** The list's status for the case screen's stage: the same precedence the backend applies. */
export function statusOfStage(stage: CaseStage): OperatorCaseStatus {
  switch (stage) {
    case "disputed":
      return "CHAIN_DISPUTED";
    case "cancel-requested":
      return "CANCEL_REQUESTED";
    case "executed":
      return "EXECUTED";
    case "compensated":
      return "COMPENSATED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "PROPOSED";
  }
}

export function rowFromBrief(brief: OperatorCaseBrief, providerName: string, now: number = Date.now()): PenaltyRow {
  const proposal = brief.case.proposal;
  const facts = caseFacts(brief, now);
  const status = statusOfStage(facts.stage);
  const nextDeadline =
    status === "CHAIN_DISPUTED"
      ? facts.disputeExpiresAt
      : status === "CANCEL_REQUESTED"
        ? (facts.cancel?.deadline ?? null)
        : status === "PROPOSED"
          ? facts.executableAt
          : null;
  return {
    id: proposal.id,
    providerId: proposal.providerId,
    providerName,
    toolName: proposal.toolName ?? null,
    amount: proposal.penaltyAmount,
    status,
    proposedAt: proposal.clocks.proposedAt,
    disputedAt: facts.disputedAt,
    nextDeadline,
  };
}

/** First occurrence wins: a penalty shows once, under the most specific source. */
export function uniqueRows(rows: readonly PenaltyRow[]): PenaltyRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}

// ── What the row says ───────────────────────────────────────────────────────

/** The chip for a status, with the existing chip vocabulary. */
export function penaltyChip(row: Pick<PenaltyRow, "status" | "disputedAt" | "nextDeadline">, now: number = Date.now()): {
  status: StatusChipKey;
  detail?: string;
} {
  switch (row.status) {
    case "CHAIN_DISPUTED":
      return { status: "disputed" };
    case "DISPUTED":
      return { status: "waiting", detail: "old process" };
    case "CANCEL_REQUESTED":
      return { status: "waiting", detail: "cancel to sign" };
    case "PROPOSED": {
      if (row.disputedAt) return { status: "upheld" };
      const at = row.nextDeadline ? Date.parse(row.nextDeadline) : Number.NaN;
      return { status: "waiting", detail: !Number.isNaN(at) && at <= now ? "executable" : "dispute window" };
    }
    case "EXECUTED":
      return { status: "executed" };
    case "COMPENSATED":
      return { status: "closed", detail: "paid back" };
    case "CANCELLED":
      return { status: "cancelled" };
    case "EXPIRED":
      return { status: "expired" };
  }
}

/** "3 days", "17h", "45 min", "under a minute" — whole units, rounded up. */
export function durationLeft(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(ms / 86_400_000)} days`;
}

export type PenaltyNext =
  /** Rendered as the shared dispute `Deadline`. */
  | { kind: "dispute"; until: string; from: string | null }
  | { kind: "text"; text: string; until: string | null; urgent: boolean }
  | { kind: "none" };

/** What happens next on the penalty, and when. */
export function penaltyNext(row: Pick<PenaltyRow, "status" | "disputedAt" | "nextDeadline">, now: number = Date.now()): PenaltyNext {
  const until = row.nextDeadline;
  const left = until ? Date.parse(until) - now : Number.NaN;
  const known = !Number.isNaN(left);
  switch (row.status) {
    case "CHAIN_DISPUTED":
      return until ? { kind: "dispute", until, from: row.disputedAt } : { kind: "text", text: "Arbiter rules", until: null, urgent: false };
    case "CANCEL_REQUESTED":
      return {
        kind: "text",
        text: !known ? "Arbiter signs the cancel" : left <= 0 ? "Cancel overdue" : `Arbiter signs the cancel · ${durationLeft(left)} left`,
        until,
        urgent: known && left < 24 * 3_600_000,
      };
    case "PROPOSED":
      return {
        kind: "text",
        text: !known ? "Waiting to go on chain" : left <= 0 ? "Executable now" : `Executable in ${durationLeft(left)}`,
        until,
        urgent: false,
      };
    case "DISPUTED":
      return { kind: "text", text: "Open it to see where it stands", until, urgent: false };
    default:
      return { kind: "none" };
  }
}

/** Typed text matches the provider or the tool. */
export function rowMatches(row: Pick<PenaltyRow, "providerName" | "toolName">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.providerName.toLowerCase().includes(q) || (row.toolName ?? "").toLowerCase().includes(q);
}

const WAITING_VERB: Record<string, string> = {
  "slash.suspend": "Suspend",
  "slash.compensated": "Pay-back",
  "slash.sweep": "Fleet sweep",
};

/** Register codes of the two-person actions on a penalty, by approval action. */
export const PENALTY_APPROVAL_CODES: Record<string, string> = {
  "slash.suspend": "S-1",
  "slash.compensated": "S-5",
  "slash.sweep": "S-11",
};

/** "Suspend waiting for approval · Riley or Iris": a request on this penalty no one has decided yet. */
export function waitingText(action: string, approverNames: readonly string[]): string {
  const verb = WAITING_VERB[action] ?? "A request";
  const first = approverNames.map((name) => name.split(/\s+/)[0] ?? name);
  const who =
    first.length === 0 ? "" : first.length <= 2 ? ` · ${first.join(" or ")}` : ` · ${first.slice(0, 2).join(", ")} or others`;
  return `${verb} waiting for approval${who}`;
}
