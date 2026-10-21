"use client";

import { useQuery } from "@tanstack/react-query";

import { isNotification, type NotificationItem } from "@/app/(console)/provider/inbox/_components/inbox-item";
import { noticeView } from "@/app/(console)/provider/inbox/_components/notice-view";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { listNotifications } from "@/services/account.service";

import { inboxBreakdown, isProviderEvent, PROVIDER_NOTIFICATION_EVENTS } from "./inbox";
import { repliableReports, useOpenReports } from "./use-needs-action";

/** The fold key of a notice, as the Inbox page folds them (it does not depend on tool names). */
export function noticeGroupKey(item: { event: string; subjectId?: string | null; payload?: unknown }): string | null {
  return noticeView({ title: "", body: "", createdAt: "", ...item }, { toolName: () => null }).groupKey;
}

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
  const reports = useOpenReports();

  const items: NotificationItem[] = (notifications.data?.items ?? [])
    .filter(isNotification)
    .filter((item) => isProviderEvent(item.event, item.payload));
  const reportIds = repliableReports(reports.data?.items ?? []).map((report) => report.id);
  const breakdown = inboxBreakdown({
    urgent: penalties.needsAction.map((notice) => [notice.id, ...(notice.proposalId ? [notice.proposalId] : [])]),
    reports: reportIds,
    notifications: items,
    groupKey: noticeGroupKey,
  });
  const count = breakdown.penalties + breakdown.reports + breakdown.notices;

  return { notifications, items, reportIds, penalties, count, breakdown };
}
