import { DASH, stampUtc } from "@/features/g34a/stats";
import type {
  Dispute,
  SlashProposalEvent,
  SlashProposalSummary,
} from "@/interfaces/provider-disputes";

import type { TimelineEvent } from "@/components/ui/timeline";

/**
 * The case timeline's case timeline, built two different ways depending on how much of
 * the wire the caller can reach — see `@/interfaces/provider-disputes`'s file
 * header for why. Neither path invents a timestamp; both state plainly what
 * they could not show.
 */

/** "BREACH_PROPOSED" → "Breach proposed". A generic transform, not a lookup table — holds for any `kind` the backend adds later. */
function titleCaseKind(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The rich path: a real `SlashProposalEvent[]` (already-occurred history,
 * backend-authored sentences) plus the two forward-looking milestones the
 * case's own clocks name. The two milestones are never invented timestamps —
 * they render only the clock fields the API actually returned, worded with
 * the design's own static copy ("upheld · partial · overturned", "nothing
 * executes before this, even if you do nothing" — the same sentence the slash case screen's
 * inaction forecast uses).
 */
export function buildRichTimeline(
  events: readonly SlashProposalEvent[],
  proposal: SlashProposalSummary
): TimelineEvent[] {
  const rows: TimelineEvent[] = events.map((event, index) => ({
    id: event.id,
    time: stampUtc(event.occurredAt),
    label: titleCaseKind(event.kind),
    meta: event.summary,
    // The most recent real event is "in progress" until something newer
    // supersedes it; everything before it already happened.
    tone: index === events.length - 1 ? "primary" : "success",
  }));

  const { clocks } = proposal;

  if (clocks.platformDecisionDueAt && !proposal.resolvedAt) {
    rows.push({
      id: "milestone-platform-decision-due",
      time: stampUtc(clocks.platformDecisionDueAt),
      label: "Our response due",
      meta: "upheld · partial · overturned",
      tone: "neutral",
    });
  }

  if (!proposal.executedAt) {
    rows.push({
      id: "milestone-earliest-execution",
      time: stampUtc(clocks.earliestExecutionAt),
      label: "Earliest possible execution",
      meta: "nothing executes before this, even if you do nothing",
      tone: "neutral",
    });
  }

  return rows;
}

/**
 * The reduced path: a plain `Dispute` row with no linked slash-proposal case
 * (the one real seed dispute is this shape — a `VERDICT` dispute with no
 * `platformDueAt` this app can read). Every row here is a real, stored
 * timestamp on the dispute itself. No platform-side milestone is rendered —
 * there is nothing honest to put on it.
 */
export function buildDisputeOnlyTimeline(dispute: Dispute): TimelineEvent[] {
  const rows: TimelineEvent[] = [
    {
      id: "filed",
      time: stampUtc(dispute.createdAt),
      label: "Dispute filed",
      meta: dispute.reason,
      tone: "success",
    },
  ];

  if (dispute.acknowledgedAt) {
    rows.push({
      id: "acknowledged",
      time: stampUtc(dispute.acknowledgedAt),
      label: "Acknowledged",
      meta: dispute.deadlineAt ? `response due ${stampUtc(dispute.deadlineAt)} UTC` : undefined,
      tone: dispute.resolvedAt ? "success" : "primary",
    });
  } else {
    rows.push({
      id: "awaiting-ack",
      time: DASH,
      label: "Awaiting acknowledgement",
      meta: "the response clock has not started",
      tone: "neutral",
    });
  }

  if (dispute.resolvedAt) {
    rows.push({
      id: "resolved",
      time: stampUtc(dispute.resolvedAt),
      label: "Resolved",
      meta: dispute.resolutionNote ?? undefined,
      tone: "success",
    });
  }

  return rows;
}
