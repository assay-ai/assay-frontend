import { DASH, stampUtc } from "@/features/g34a/stats";
import type {
  Dispute,
  SlashProposalEvent,
  SlashProposalSummary,
} from "@/interfaces/provider-disputes";

import type { TimelineEvent } from "@/components/ui/timeline";
import { eventLabel, eventSummary } from "@/features/provider-slash-case/labels";

/**
 * The case timeline's case timeline, built two different ways depending on how much of
 * the wire the caller can reach — see `@/interfaces/provider-disputes`'s file
 * header for why. Neither path invents a timestamp; both state plainly what
 * they could not show.
 */

/**
 * The timeline endpoint is HTTP-cached for ~10s server-side, so a refetch right
 * after Acknowledge can still answer without the ACKNOWLEDGED event even though
 * the case already carries `clocks.acknowledgedAt`. Fill that one event in from
 * the case's own clock so every screen reading both agrees; once the endpoint
 * catches up its own row wins and nothing is duplicated.
 */
export function withAcknowledgedEvent(
  events: readonly SlashProposalEvent[],
  proposal: SlashProposalSummary
): SlashProposalEvent[] {
  const acknowledgedAt = proposal.clocks.acknowledgedAt;
  if (!acknowledgedAt || events.some((event) => event.kind === "ACKNOWLEDGED")) {
    return [...events];
  }
  const synthesized: SlashProposalEvent = {
    id: "derived-acknowledged",
    occurredAt: acknowledgedAt,
    kind: "ACKNOWLEDGED",
    actorType: "provider",
    actorId: null,
    summary: "Provider opened the case",
    detail: {},
  };
  return [...events, synthesized].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
  );
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
  const all = withAcknowledgedEvent(events, proposal);
  const rows: TimelineEvent[] = all.map((event, index) => ({
    id: event.id,
    time: stampUtc(event.occurredAt),
    label: eventLabel(event.kind, event.detail),
    meta: eventSummary(event.summary, {
      ...proposal.penaltyAmount,
      toolName: proposal.toolName,
      bindingId: proposal.bindingId,
    }),
    // The most recent real event is "in progress" until something newer
    // supersedes it; everything before it already happened.
    tone: index === all.length - 1 ? "primary" : "success",
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
