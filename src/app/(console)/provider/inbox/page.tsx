"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCount } from "@/features/buyer/period";
import { ApiError } from "@/libs/ApiClient";
import { getUnreadCount, listNotifications } from "@/services/account.service";

import { InboxItem, isNotification } from "./_components/inbox-item";

/**
 * Action inbox — route `/provider/inbox`.
 *
 * ## This screen renders empty, permanently, and that is the correct result
 *
 * `GET /notifications` answers `200 { items: [], pageInfo: … }` and
 * `GET /notifications/unread-count` answers `{ count: 0 }`. That is not a
 * seeding oversight and not a scope bug: **nothing in the backend's `src/`
 * ever writes the `notifications` table.** `NotificationsService` reads, marks
 * read and counts; no producer exists on any path — not settlement, not the
 * verification worker, not the payout batch. So the screen is built against
 * the shape the endpoint declares, and shows its empty state.
 *
 * Rows were deliberately NOT seeded to make the screen look alive. A demo row
 * would make an unbuilt producer look like a built one, which is the exact
 * failure this console exists to avoid.
 *
 * ## What the inbox is, and the one card on the frame that contradicts it
 *
 * The Inbox is not a notification centre. It contains only items that have a
 * deadline or require a decision; a read/unread list of things that happened
 * is the verdict feed's job. The frame's own Note
 * says the same thing in the provider's words, and it is rendered verbatim.
 *
 * The design then draws **three** item cards while its title and its sidebar
 * badge both say **2 items**. The third — "Payout sent · $1,356.68 …", a
 * `circle-check` with a "Reconcile" button — is a payout confirmation, i.e.
 * precisely the thing that belongs to the verdict feed rather than here.
 * The design's own count agrees and excludes it. Nothing is filtered in
 * code, because there is nothing to filter.
 *
 * ## Two fields this screen needs and `NotificationDto` does not have
 *
 * - **A deadline.** The predicate "has a clock or a decision" cannot be
 *   evaluated: the DTO carries `id`, `event`, `severity`, `title`, `body`,
 *   `subjectType`, `subjectId`, `payload`, `readAt`, `createdAt` — and no
 *   due-at of any kind. The frame's red `respond by 2026-08-13 09:14 UTC ·
 *   2d 21h` line has no source. Until one exists, an item's mono line carries
 *   `createdAt`, which is the only timestamp on the wire.
 * - **An action target.** Every card on the frame ends in a CTA — "Open the
 *   case", "Review the 14", "Reconcile" — and no field names a destination.
 *   `subjectType`/`subjectId` might route one day, but no producer has ever
 *   written a value, so there is no mapping to write against. The CTA is
 *   therefore not rendered at all rather than rendered inert.
 *
 * Both are missing fields on the API.
 *
 * ## Severity is the only field the icon can key on
 *
 * The frame paints one icon per item — `scale`/`$danger-500`,
 * `file-diff`/`$warning-500`, `circle-check`/`$success-500`. Those track the
 * *kind* of item, which lives in `event`, whose catalogue is unenumerable from
 * here (no producer, no published list). `severity` is a closed three-value
 * enum on the DTO, and its three values map onto the frame's three tones
 * exactly, so that is what is keyed on. When the event catalogue lands this is
 * the one function to change.
 */

export default function ProviderInboxPage() {
  const notifications = useQuery({
    queryKey: ["notifications", "inbox"],
    queryFn: () => listNotifications({ limit: 50 }),
  });

  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: getUnreadCount,
  });

  const items = (notifications.data?.items ?? []).filter(isNotification);
  const unreadCount = unread.data?.count ?? 0;

  const error = [notifications.error, unread.error].find(
    (e): e is ApiError => e instanceof ApiError,
  );

  return (
    <>
      {/* Page Header. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Inbox</h1>
          {/*
            The frame writes "2 items · …". The count is live; the clause after
            it is the design's, word for word.
          */}
          <p className="truncate font-mono text-mono-12 text-03">
            {formatCount(items.length)} item{items.length === 1 ? "" : "s"} · only things with a
            clock or a decision — a read/unread list of things that happened is the verdict feed
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {/*
            `POST /notifications/read-all` exists on the API and has **no
            function in `src/services/account.service.ts`**, so this control cannot act, and it says so rather
            than pretending. It would also have nothing to act on: the list is
            empty and no producer writes it.
          */}
          <Button
            variant="secondary"
            icon={<Check />}
            disabled
            title={
              unreadCount === 0
                ? "Nothing unread."
                : "Marking all as read is not available yet."
            }
          >
            Mark all read
          </Button>
        </div>
      </header>

      {error ? (
        <Banner
          tone="danger"
          title="The inbox could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {/* Note — verbatim. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
        <Info
          width={15}
          height={15}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-03"
        />
        <p className="min-w-0 flex-1 text-body-13 leading-[1.6] text-02">
          This is not a notification centre. Conflating the two is how a dispute deadline ends up
          below a payout confirmation.
        </p>
      </div>

      {/* Items — vertical, gap 12. */}
      <section className="flex w-full flex-col gap-3">
        {notifications.isLoading ? (
          <p role="status" aria-live="polite" className="text-body-md text-02">
            Loading your inbox…
          </p>
        ) : items.length > 0 ? (
          items.map((item) => <InboxItem key={item.id} item={item} />)
        ) : (
          /*
            The design draws no empty state — its provider has items. Every word
            here is OURS and is provisional. It deliberately does not say
            "you're all caught up": the list is empty because nothing writes
            it, and a provider who reads "all caught up" would take an unbuilt
            producer for an empty queue.
          */
          <EmptyState
            className="max-w-[560px]"
            icon={null}
            title="Nothing is waiting on you"
            description="Only items with a deadline or a decision reach the inbox — a proposed SLA breach, a policy change you can object to. Things that merely happened do not."
          />
        )}
      </section>
    </>
  );
}
