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
  // T3: a contract major a binding serves is going away. Filed per organization for buyers too; the payload's role says whose.
  "tool_version.deprecated",
  "tool_version.retired",
  // Buyer reports on calls this provider served (provider side only: see isProviderEvent).
  "call_dispute.opened",
  "call_dispute.decided",
  // "Publish your own API": review, takedown and promotion notices.
  "provider_tool.approved",
  "provider_tool.rejected",
  "provider_tool.taken_down",
  "provider_tool.takedown_lifted",
  "provider_tool.promotion_invited",
] as const;

/**
 * Whether a notice is the provider's. A `tool_version.*` notice is sent to
 * buyers and providers alike, so it counts only when its payload says
 * `role: "PROVIDER"`.
 */
export function isProviderEvent(event: string | null | undefined, payload?: unknown): boolean {
  if (typeof event !== "string") return false;
  if (event === "tool_version.deprecated" || event === "tool_version.retired") {
    return Boolean(payload && typeof payload === "object" && (payload as { role?: unknown }).role === "PROVIDER");
  }
  if (event.startsWith("call_dispute.")) {
    // Every call_dispute.* notice says whose side it is for; an organization can be both.
    const role = payload && typeof payload === "object" ? (payload as { role?: unknown }).role : undefined;
    return role === "provider";
  }
  return event.startsWith("provider.") || event.startsWith("provider_tool.");
}

/**
 * What the nav badge counts, and what the page heading states: the penalties
 * that need a decision, the bad-result reports waiting for a reply, plus
 * unread provider notices. A notice about something already counted (its
 * subject is one of that item's ids — a penalty's on-chain request id or
 * Assay's case id, a report's id) is not counted twice, and notices folded
 * together on the page (`collapseNotices`) count once.
 */
export interface InboxBreakdown {
  /** Penalties that can still be disputed. */
  penalties: number;
  /** Bad-result reports the provider can still reply to. */
  reports: number;
  /** Unread provider notices not about one of those. */
  notices: number;
}

export function inboxBreakdown(input: {
  urgent: readonly (readonly string[])[];
  /** Open reports' ids. */
  reports?: readonly string[];
  notifications: readonly { event: string; readAt?: string | null; subjectId?: string | null; payload?: unknown; createdAt?: string }[];
  /** The page's fold key (`collapseNotices`); unread notices with one key count once. */
  groupKey?: (item: { event: string; subjectId?: string | null; payload?: unknown }) => string | null;
}): InboxBreakdown {
  const reports = input.reports ?? [];
  const counted = new Set([...input.urgent.flat(), ...reports].map((id) => id.toLowerCase()));
  const unread = input.notifications.filter(
    (item) => isProviderEvent(item.event, item.payload) && !item.readAt && !(item.subjectId && counted.has(item.subjectId.toLowerCase())),
  );
  const keys = new Set<string>();
  let notices = 0;
  for (const item of unread) {
    const key = input.groupKey?.(item) ?? null;
    if (key !== null) {
      if (keys.has(key)) continue;
      keys.add(key);
    }
    notices += 1;
  }
  return { penalties: input.urgent.length, reports: reports.length, notices };
}

export function inboxCount(input: Parameters<typeof inboxBreakdown>[0]): number {
  const { penalties, reports, notices } = inboxBreakdown(input);
  return penalties + reports + notices;
}

/**
 * The Inbox heading: the badge's number broken into what it counts, so it can
 * be matched against the page ("2 new: 1 penalty to decide on, 1 unread notice").
 */
export function inboxHeadline({ penalties, reports = 0, notices }: Omit<InboxBreakdown, "reports"> & { reports?: number }): string {
  const total = penalties + reports + notices;
  if (total === 0) return "Nothing new. Penalties to decide on and notices about your tools land here.";
  const parts = [
    penalties ? `${penalties} ${penalties === 1 ? "penalty" : "penalties"} to decide on` : null,
    reports ? `${reports} ${reports === 1 ? "report" : "reports"} to reply to` : null,
    notices ? `${notices} unread ${notices === 1 ? "notice" : "notices"} (marked with a dot)` : null,
  ].filter(Boolean);
  return `${total} new: ${parts.join(", ")}.`;
}

/**
 * Notices that say the same thing again, shown once (newest first in, newest
 * kept): the daily stake warning, a window's repeated warnings, a run of
 * penalties cancelled for one reason. `key` returns null for a notice that
 * must stand alone. The kept notice counts as unread if any folded one is.
 */
export interface CollapsedNotice<T> {
  item: T;
  /** Older notices folded into this one. */
  repeats: number;
  /** The oldest folded notice's time; null when nothing was folded. */
  since: string | null;
  unread: boolean;
}

export function collapseNotices<T extends { createdAt: string; readAt?: string | null }>(
  items: readonly T[],
  key: (item: T) => string | null,
): CollapsedNotice<T>[] {
  const out: CollapsedNotice<T>[] = [];
  const byKey = new Map<string, CollapsedNotice<T>>();
  for (const item of items) {
    const k = key(item);
    const seen = k === null ? undefined : byKey.get(k);
    if (seen) {
      seen.repeats += 1;
      if (!seen.since || item.createdAt < seen.since) seen.since = item.createdAt;
      seen.unread = seen.unread || !item.readAt;
      continue;
    }
    const entry: CollapsedNotice<T> = { item, repeats: 0, since: null, unread: !item.readAt };
    out.push(entry);
    if (k !== null) byKey.set(k, entry);
  }
  return out;
}

/**
 * The title of a folded run of cancellations: "6 proposed penalties were
 * cancelled: nothing was taken" — the reason is the notice's body.
 */
export function cancelledRunTitle(count: number): string {
  return count === 1 ? "A proposed penalty was cancelled: nothing was taken" : `${count} proposed penalties were cancelled: nothing was taken`;
}
