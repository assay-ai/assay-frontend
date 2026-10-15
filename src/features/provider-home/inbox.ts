/**
 * The provider Inbox's audience rule.
 *
 * Notifications are filed per organization, and an organization can be a
 * buyer and a provider at once, so `GET /notifications` can hold buyer
 * notices (spend thresholds, refunds, deposits). The provider console shows
 * only the provider's: the events the backend catalogue files under
 * `provider.*` (assay-backend `NotificationEvent`). The list is sent as the
 * server-side `event` filter AND re-checked here, so a new buyer event can
 * never leak in even if the filter is ignored.
 */
export const PROVIDER_NOTIFICATION_EVENTS = [
  "provider.stake_headroom_low",
  "provider.stake_grace_opened",
  "provider.stake_grace_expired",
  "provider.stake_grace_cured",
  "provider.slash_proposed",
  "provider.sla_breach_proposed",
  "provider.sla_window_warning",
  "provider.slash_decided",
  "provider.slash_executed",
  "provider.slash_reversed",
  "provider.payout_sent",
] as const;

export function isProviderEvent(event: string | null | undefined): boolean {
  return typeof event === "string" && event.startsWith("provider.");
}

/**
 * What the nav badge counts, and what the page heading states: the penalties
 * that need a decision plus unread provider notices. A notice about a penalty
 * already counted (its subject is one of that penalty's ids — the on-chain
 * request id or Assay's case id) is not counted twice.
 */
export interface InboxBreakdown {
  /** Penalties that can still be disputed. */
  penalties: number;
  /** Unread provider notices not about one of those penalties. */
  notices: number;
}

export function inboxBreakdown(input: {
  urgent: readonly (readonly string[])[];
  notifications: readonly { event: string; readAt?: string | null; subjectId?: string | null }[];
}): InboxBreakdown {
  const urgentIds = new Set(input.urgent.flat().map((id) => id.toLowerCase()));
  const unread = input.notifications.filter(
    (item) => isProviderEvent(item.event) && !item.readAt && !(item.subjectId && urgentIds.has(item.subjectId.toLowerCase())),
  );
  return { penalties: input.urgent.length, notices: unread.length };
}

export function inboxCount(input: Parameters<typeof inboxBreakdown>[0]): number {
  const { penalties, notices } = inboxBreakdown(input);
  return penalties + notices;
}

/**
 * The Inbox heading: the badge's number broken into what it counts, so it can
 * be matched against the page ("2 new: 1 penalty to decide on, 1 unread notice").
 */
export function inboxHeadline({ penalties, notices }: InboxBreakdown): string {
  const total = penalties + notices;
  if (total === 0) return "Nothing new. Penalties to decide on and notices about your tools land here.";
  const parts = [
    penalties ? `${penalties} ${penalties === 1 ? "penalty" : "penalties"} to decide on` : null,
    notices ? `${notices} unread ${notices === 1 ? "notice" : "notices"} (marked with a dot)` : null,
  ].filter(Boolean);
  return `${total} new: ${parts.join(", ")}.`;
}
