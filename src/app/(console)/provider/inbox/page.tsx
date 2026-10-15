"use client";

import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { NeedsActionStrip } from "@/features/provider-home/needs-action-strip";
import { useProviderNeedsAction } from "@/features/provider-home/use-needs-action";
import { inboxHeadline } from "@/features/provider-home/inbox";
import { useProviderInbox } from "@/features/provider-home/use-provider-inbox";
import { StakeSheet } from "@/features/provider-stake/stake-sheet";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { formatMoney } from "@/utils/money";

import { InboxItem } from "./_components/inbox-item";

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
  const { notifications, items, penalties, breakdown } = useProviderInbox();

  // The same "Needs action" list as Home: penalties, windows near the promise,
  // a short stake, a suspended tool.
  const { attention: urgent } = useProviderNeedsAction();
  const [stakeOpen, setStakeOpen] = React.useState(false);
  const stake = useStakeStatus();
  const loading = notifications.isPending || penalties.isLoading;

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
        {items.length > 0 ? (
          <h2 id="inbox-notices" className="text-label-md text-01">
            Notices
          </h2>
        ) : (
          <h2 id="inbox-notices" className="sr-only">
            Notices
          </h2>
        )}
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
            description="A penalty you can dispute, a failing window or a stake warning lands here."
          />
        ) : null}
      </section>

      <StakeSheet
        open={stakeOpen}
        onOpenChange={setStakeOpen}
        amount={stake.shortfall}
        reason={
          stake.required
            ? `Your paid tools need ${formatMoney(stake.required, { decimals: 2 })} of stake in total.`
            : "Stake backs the failure rate you promise on paid tools."
        }
        onStaked={() => void stake.refetch()}
      />
    </>
  );
}
