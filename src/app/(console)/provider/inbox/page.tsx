"use client";

import { useQuery } from "@tanstack/react-query";

import { PageState } from "@/components/patterns/page-state";
import { needsActionItems } from "@/features/provider-home/needs-action";
import { NeedsActionStrip } from "@/features/provider-home/needs-action-strip";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { listNotifications } from "@/services/account.service";

import { InboxItem, isNotification } from "./_components/inbox-item";

/**
 * Inbox — only things with a deadline or a decision.
 *
 * Penalties that can still be disputed come first, read live from the same
 * source as the Penalties page, with the on-chain deadline (`executableAt`)
 * counting down: they matter even when no notification was written for them
 * (business #5). Below them, the notifications Assay sent, each with a link to
 * its subject when the console has a page for it.
 *
 * "Mark all read" is not offered: the console has no call for it yet.
 */
export default function ProviderInboxPage() {
  const notifications = useQuery({
    queryKey: ["notifications", "inbox"],
    queryFn: () => listNotifications({ limit: 50 }),
  });
  const penalties = usePenaltySummary();

  const items = (notifications.data?.items ?? []).filter(isNotification);
  const urgent = needsActionItems({
    penalties: penalties.needsAction,
    openWindows: [],
    bindings: [],
    stake: { enough: null, shortfall: null },
    label: () => "",
  });

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-sm text-01 tablet:text-heading-md">Inbox</h1>
        <p className="text-body-13 text-03">Only things with a deadline or a decision.</p>
      </header>

      {urgent.length > 0 ? <NeedsActionStrip items={urgent} onOpenStake={() => undefined} /> : null}

      <section className="flex w-full flex-col gap-3" aria-label="Messages">
        {notifications.isPending ? (
          <PageState kind="loading" rows={3} label="Loading your inbox" />
        ) : notifications.isError ? (
          <PageState kind="error" description="Your inbox could not be loaded." onRetry={() => void notifications.refetch()} />
        ) : items.length > 0 ? (
          items.map((item) => <InboxItem key={item.id} item={item} />)
        ) : urgent.length === 0 ? (
          <PageState
            kind="empty"
            title="Nothing is waiting on you"
            description="A penalty you can dispute, a policy change you can object to or an answer to a tool request lands here."
          />
        ) : null}
      </section>
    </>
  );
}
