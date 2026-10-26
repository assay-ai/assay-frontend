"use client";

import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { cancelledRunTitle, collapseNotices, inboxHeadline, noticesBesideActions } from "@/features/provider-home/inbox";
import { NeedsActionStrip, WatchList } from "@/features/provider-home/needs-action-strip";
import { useProviderBindings } from "@/features/provider-home/use-listing-progress";
import { useProviderNeedsAction } from "@/features/provider-home/use-needs-action";
import { useProviderInbox } from "@/features/provider-home/use-provider-inbox";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { stakeStatus } from "@/features/provider-stake/stake-status";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";

import { InboxItem, inboxView } from "./_components/inbox-item";
import type { NoticeContext } from "./_components/notice-view";
import { splitOfParams } from "@/features/provider-slash-case/distribution";
import { useChainTerms } from "@/hooks/useChainTerms";

/**
 * Inbox — what needs a decision, then what Assay told you about your tools.
 *
 * Penalties that can still be disputed come first, read live from the same
 * source as the Penalties page, with the on-chain deadline (`executableAt`)
 * counting down: they matter even when no notification was written for them
 * (business #5). Below them, the provider notices Assay sent (buyer notices of
 * the same organization are filtered out, see `features/provider-home/inbox`),
 * each with a link to its subject when the console has a page for it.
 *
 * The nav badge reads the same hook, so it always equals the count stated
 * here. "Mark all read" is not offered: the console has no call for it yet.
 */
export default function ProviderInboxPage() {
  const { notifications, items: allItems, reportIds, penalties, breakdown } = useProviderInbox();
  // A report waiting for a reply is in Needs action: its notice is not listed again.
  const items = React.useMemo(() => noticesBesideActions(allItems, reportIds), [allItems, reportIds]);

  // The same "Needs action" list as Home: penalties, windows near the promise,
  // a short stake, a suspended tool.
  const { attention: urgent, watch } = useProviderNeedsAction();
  const [stakeOpen, setStakeOpen] = React.useState(false);
  const stake = useStakeStatus();
  const loading = notifications.isPending || penalties.isLoading;

  // Notices in the provider's words (from event + payload), tools by name, and
  // repeats folded: the daily stake warning, a window's warnings, a run of
  // penalties cancelled for one reason.
  const names = useProviderToolNames();
  const bindings = useProviderBindings();
  const chainParams = useChainTerms().params;
  const ctx: NoticeContext = React.useMemo(() => {
    const byId = new Map((bindings.data?.items ?? []).map((binding) => [binding.id, binding.toolId]));
    return {
      toolName: (bindingId) => (bindingId ? names.toolName(byId.get(bindingId)) : null),
      split: splitOfParams(chainParams),
    };
  }, [bindings.data, names, chainParams]);
  const shown = collapseNotices(
    items.map((item) => ({ ...item, view: inboxView(item, ctx) })),
    (item) => item.view.groupKey,
  ).map((entry) =>
    entry.item.event === "provider.slash_decided" && entry.repeats > 0 && entry.item.view.groupKey?.startsWith("slash-cancelled:")
      ? { ...entry, item: { ...entry.item, view: { ...entry.item.view, title: cancelledRunTitle(entry.repeats + 1) } } }
      : entry,
  );

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-sm text-01 tablet:text-heading-md">Inbox</h1>
        <p className="text-body-13 text-03" aria-live="polite">
          {loading ? "Penalties to decide on, and notices about your tools." : inboxHeadline(breakdown)}
        </p>
      </header>

      {urgent.length > 0 ? <NeedsActionStrip items={urgent} onOpenStake={() => setStakeOpen(true)} /> : null}

      <section className="flex w-full flex-col gap-3" aria-labelledby="inbox-notices">
        {items.length > 0 || watch.length > 0 ? (
          <h2 id="inbox-notices" className="text-label-md text-01">
            Notices
          </h2>
        ) : (
          <h2 id="inbox-notices" className="sr-only">
            Notices
          </h2>
        )}
        <WatchList items={watch} />
        {notifications.isPending ? (
          <PageState kind="loading" rows={3} label="Loading your inbox" />
        ) : notifications.isError ? (
          <PageState kind="error" description="Your inbox could not be loaded." onRetry={() => void notifications.refetch()} />
        ) : shown.length > 0 ? (
          shown.map(({ item, repeats, since, unread }) => (
            <InboxItem key={item.id} item={item} view={item.view} repeats={item.event === "provider.slash_decided" ? 0 : repeats} since={since ?? undefined} unread={unread} />
          ))
        ) : urgent.length === 0 && watch.length === 0 ? (
          <PageState
            kind="empty"
            title="Nothing is waiting on you"
            description="A penalty you can dispute, a failing window or a stake warning lands here."
          />
        ) : null}
      </section>

      <StakeSheet
        open={stakeOpen}
        onOpenChange={setStakeOpen}
        amount={stake.shortfall}
        reason={stake.required ? stakeStatus(stake).sentence : "Stake backs the failure rate you promise on paid tools."}
        onStaked={() => void stake.refetch()}
      />
    </>
  );
}
