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
export function inboxCount(input: {
  urgent: readonly (readonly string[])[];
  notifications: readonly { event: string; readAt?: string | null; subjectId?: string | null }[];
}): number {
  const urgentIds = new Set(input.urgent.flat().map((id) => id.toLowerCase()));
  const unread = input.notifications.filter(
    (item) => isProviderEvent(item.event) && !item.readAt && !(item.subjectId && urgentIds.has(item.subjectId.toLowerCase())),
  );
  return input.urgent.length + unread.length;
}
