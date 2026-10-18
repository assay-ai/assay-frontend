import type {
  ArbiterDispute,
  OperatorApproval,
  OperatorDirectoryEntry,
  OperatorIdentity,
  PlatformHealth,
} from "@/interfaces/operator";

import { approveBlockedBecause, approverRolesFor, isOwnRequest } from "./approvals";

/**
 * The "Needs you" inbox's rules, as pure functions: which approvals are this
 * operator's to decide, how urgent each on-chain dispute is, and what the
 * health strip says. The Home screen, the Approvals screen and the nav badge
 * all read these, so the badge always equals the Needs-you count.
 */

/**
 * Provider tool reviews and buyer call disputes waiting for this operator.
 * The caller counts each only for a role that can decide it (`useToolWork`).
 */
export interface ToolWork {
  reviews?: number;
  callDisputes?: number;
}

/**
 * What the Home heading and the nav badge both count: approvals this operator
 * can decide, plus — for whoever can rule — every open on-chain dispute, plus
 * the pending provider tool reviews and open call disputes its roles decide.
 */
export function needsYouCount(needsYouApprovals: number, openDisputes: number, canRule: boolean, toSign: number = 0, work: ToolWork = {}): number {
  return needsYouApprovals + (canRule ? openDisputes + toSign : 0) + (work.reviews ?? 0) + (work.callDisputes ?? 0);
}

// ── Approvals ───────────────────────────────────────────────────────────────

/**
 * The one name for every open request, yours or not, on the Approvals tab:
 * "All waiting · 4" (no count when nothing waits). Home accounts for the same
 * requests in one line under its sections (`waitingSummary`).
 */
export function allWaitingLabel(count: number): string {
  return count > 0 ? `All waiting · ${count}` : "All waiting";
}

/**
 * Home's one line for every waiting request, split the way the Approvals tabs
 * are (Waiting for you · Your requests · Others), so each one is accounted for:
 *   "5 requests waiting: 2 for you, 1 from you, 2 for others"
 *   "2 requests waiting, both for others" · "1 request waiting, from you"
 * Null when nothing waits. Pure.
 */
export function waitingSummary(counts: { needsYou: number; yours: number; others: number }): string | null {
  const total = counts.needsYou + counts.yours + counts.others;
  if (total === 0) return null;
  const parts = (
    [
      [counts.needsYou, "for you"],
      [counts.yours, "from you"],
      [counts.others, "for others"],
    ] as const
  ).filter(([n]) => n > 0);
  const head = `${total} ${total === 1 ? "request" : "requests"} waiting`;
  if (parts.length > 1) return `${head}: ${parts.map(([n, who]) => `${n} ${who}`).join(", ")}`;
  const who = parts[0][1];
  return total === 1 ? `${head}, ${who}` : `${head}, ${total === 2 ? "both" : "all"} ${who}`;
}

/**
 * What the "Needs you" number adds up, under the heading, when it mixes
 * approvals and disputes: "2 to approve · 2 to rule". Null when it is one kind
 * only (the section below says it). Pure.
 */
export function needsYouBreakdown(approvals: number, disputes: number, canRule: boolean, toSign: number = 0, work: ToolWork = {}): string | null {
  const reviews = work.reviews ?? 0;
  const calls = work.callDisputes ?? 0;
  const parts = [
    ...(approvals > 0 ? [`${approvals} to approve`] : []),
    ...(canRule && disputes > 0 ? [`${disputes} to rule`] : []),
    ...(canRule && toSign > 0 ? [`${toSign} to sign`] : []),
    ...(reviews > 0 ? [`${reviews} to review`] : []),
    ...(calls > 0 ? [`${calls} call ${calls === 1 ? "dispute" : "disputes"}`] : []),
  ];
  return parts.length < 2 ? null : parts.join(" · ");
}

/** The nav badge's tooltip and screen-reader text: "4 need you". */
export function needsYouBadgeText(count: number): string {
  return `${count} need${count === 1 ? "s" : ""} you`;
}

export interface ApprovalGroups {
  /** Pending, someone else's, and your roles cover it. */
  needsYou: OperatorApproval[];
  /** Pending, and you asked for it. */
  yours: OperatorApproval[];
  /** Pending, someone else's, and your roles do not cover it. */
  others: OperatorApproval[];
}

/**
 * Still waiting for a decision: pending and not past its deadline. The one
 * test for "waiting" everywhere (Approvals, the counts, the Penalties list and
 * the penalty page), so a request never waits on one screen and is gone from
 * another.
 */
export function isLiveApproval(approval: Pick<OperatorApproval, "status" | "expiresAt">, now: number = Date.now()): boolean {
  if (approval.status !== "PENDING") return false;
  const end = Date.parse(approval.expiresAt);
  return Number.isNaN(end) || end > now;
}

export function groupApprovals(
  approvals: readonly OperatorApproval[],
  me: Pick<OperatorIdentity, "id" | "roles">,
  now: number = Date.now(),
): ApprovalGroups {
  const groups: ApprovalGroups = { needsYou: [], yours: [], others: [] };
  for (const approval of approvals) {
    if (!isLiveApproval(approval, now)) continue;
    if (isOwnRequest(approval, me)) groups.yours.push(approval);
    else if (approveBlockedBecause(approval, me) === null) groups.needsYou.push(approval);
    else groups.others.push(approval);
  }
  // The one closest to expiring first: that is the one that can still be lost.
  const byExpiry = (a: OperatorApproval, b: OperatorApproval) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
  groups.needsYou.sort(byExpiry);
  groups.yours.sort(byExpiry);
  groups.others.sort(byExpiry);
  return groups;
}

/** A person's name as the console shows it: their display name, else their handle. */
export function operatorLabel(operator: Pick<OperatorDirectoryEntry, "displayName" | "subject">): string {
  return operator.displayName?.trim() || operator.subject;
}

/**
 * Who could approve a request with this register code: active operators who
 * hold one of its approver roles, other than the requester (who may not).
 */
export function eligibleApprovers(
  code: string,
  operators: readonly Pick<OperatorDirectoryEntry, "id" | "roles" | "status" | "displayName" | "subject">[],
  requesterId: string | null,
): string[] {
  const roles = approverRolesFor(code);
  if (!roles) return [];
  return operators
    .filter((op) => op.status === "ACTIVE" && op.id !== requesterId && op.roles.some((role) => roles.includes(role)))
    .map(operatorLabel);
}

// ── On-chain disputes ──────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** From this day of the 30-day window a dispute is drawn red (business finding 21). */
export const DISPUTE_RED_FROM_DAY = 20;

export interface DisputeUrgency {
  /** Whole days since the dispute, 0 on the first day. Null when the dispute time is unknown. */
  day: number | null;
  /** Whole days left before it expires unruled (ceil). Null when unknown. */
  daysLeft: number | null;
  /** 0..1 of the 30 days used. */
  used: number;
  urgent: boolean;
  expired: boolean;
  /** "12 days left", "Expires today", "Expired". */
  label: string;
}

export function disputeUrgency(
  row: Pick<ArbiterDispute, "disputedAt" | "expiresAt">,
  now: number = Date.now(),
): DisputeUrgency {
  const start = row.disputedAt ? Date.parse(row.disputedAt) : Number.NaN;
  const end = row.expiresAt ? Date.parse(row.expiresAt) : Number.isNaN(start) ? Number.NaN : start + 30 * DAY_MS;
  if (Number.isNaN(end)) return { day: null, daysLeft: null, used: 0, urgent: false, expired: false, label: "Expiry unknown" };
  const total = Number.isNaN(start) ? 30 * DAY_MS : Math.max(1, end - start);
  const day = Number.isNaN(start) ? null : Math.max(0, Math.floor((now - start) / DAY_MS));
  const msLeft = end - now;
  if (msLeft <= 0) return { day, daysLeft: 0, used: 1, urgent: true, expired: true, label: "Expired" };
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  const used = Math.min(1, Math.max(0, 1 - msLeft / total));
  const urgent = (day !== null && day >= DISPUTE_RED_FROM_DAY) || daysLeft <= 30 - DISPUTE_RED_FROM_DAY;
  const label = msLeft < DAY_MS ? "Expires today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  return { day, daysLeft, used, urgent, expired: false, label };
}

/**
 * "Day 24 of 30 · 7 days left" — the one way the console says where a dispute
 * stands. Home, Penalties, Arbiter and the penalty page all print this, from
 * the same `disputeUrgency`, so they cannot disagree.
 */
export function disputeDayText(row: Pick<ArbiterDispute, "disputedAt" | "expiresAt">, now: number = Date.now()): string {
  const urgency = disputeUrgency(row, now);
  return urgency.day === null ? urgency.label : `Day ${Math.min(30, urgency.day + 1)} of 30 · ${urgency.label}`;
}

/** Fewest days left first; unknown expiry last. */
export function sortDisputesByDaysLeft<T extends Pick<ArbiterDispute, "disputedAt" | "expiresAt" | "requestId">>(
  rows: readonly T[],
): T[] {
  const end = (row: T) => {
    if (row.expiresAt) return Date.parse(row.expiresAt);
    if (row.disputedAt) return Date.parse(row.disputedAt) + 30 * DAY_MS;
    return Number.POSITIVE_INFINITY;
  };
  return [...rows].sort((a, b) => end(a) - end(b) || a.requestId.localeCompare(b.requestId));
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthIssue {
  id: string;
  text: string;
}

/**
 * What in the health read is red. Only the measures that carry a threshold
 * are judged — the false-positive gate, a stale chain indexer, paused
 * contracts; the rest are figures, and inventing a bound for them would turn
 * the strip into noise.
 */
export function healthIssues(health: PlatformHealth): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (health.falsePositiveRate >= health.falsePositiveGate) {
    issues.push({
      id: "false-positive",
      text: `False-positive rate ${pct(health.falsePositiveRate)}, gate ${pct(health.falsePositiveGate)}`,
    });
  }
  for (const chain of health.chainState ?? []) {
    if (chain.paused) issues.push({ id: `paused:${chain.chainId}`, text: "Contracts paused" });
    if (chain.stale) {
      issues.push({
        id: `stale:${chain.chainId}`,
        text:
          chain.lagSeconds === null
            ? "Chain indexer has not caught up"
            : `Chain indexer ${Math.max(1, Math.round(chain.lagSeconds / 60))} min behind`,
      });
    }
  }
  return issues;
}

function pct(share: number): string {
  const value = share * 100;
  return `${value < 10 && value % 1 !== 0 ? value.toFixed(1) : Math.round(value)}%`;
}

/** "checked 30 s ago" / "checked 2 min ago". */
export function checkedAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "checked just now";
  if (seconds < 60) return `checked ${Math.round(seconds / 10) * 10} s ago`;
  return `checked ${Math.round(seconds / 60)} min ago`;
}
