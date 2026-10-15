"use client";

import { useQuery } from "@tanstack/react-query";

import { isNotification, type NotificationItem } from "@/app/(console)/provider/inbox/_components/inbox-item";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { listNotifications } from "@/services/account.service";

import { inboxCount, isProviderEvent, PROVIDER_NOTIFICATION_EVENTS } from "./inbox";

/**
 * The provider Inbox, read once for the page and the nav badge (same query
 * key), so the badge always equals what the page shows.
 */
export function useProviderInbox() {
  const notifications = useQuery({
    queryKey: ["notifications", "provider-inbox"],
    queryFn: () => listNotifications({ limit: 50, event: [...PROVIDER_NOTIFICATION_EVENTS] }),
    refetchInterval: 60_000,
    retry: 0,
  });
  const penalties = usePenaltySummary();

  const items: NotificationItem[] = (notifications.data?.items ?? [])
    .filter(isNotification)
    .filter((item) => isProviderEvent(item.event));
  const count = inboxCount({
    urgent: penalties.needsAction.map((notice) => [notice.id, ...(notice.proposalId ? [notice.proposalId] : [])]),
    notifications: items,
  });

  return { notifications, items, penalties, count };
}
