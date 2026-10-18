"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { mayReviewTools, REVIEW_KIND_LABEL, sortReviewQueue } from "@/features/operator/provider-tool-review";
import { OperatorToolsTabs } from "@/features/operator/provider-tool-ui";
import { useOperatorSession } from "@/features/operator/session-context";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listProviderToolReviews } from "@/services/operator-provider-tools.service";

/**
 * Provider tool reviews — `/operator/tools/reviews` (design spec §7.6).
 * Pending first, oldest submission first: a first review lists the tool in
 * the catalogue; a change to a listed tool serves only once approved, while
 * the approved version keeps serving.
 */
function ReviewsScreen() {
  const me = useOperatorSession();
  const [show, setShow] = React.useState<"pending" | "all">("pending");
  const queue = useQuery({ queryKey: ["operator", "reviews", show], queryFn: () => listProviderToolReviews(show === "pending"), retry: 0, refetchInterval: 60_000 });
  const rows = sortReviewQueue(queue.data ?? []);
  return (
    <>
      <OperatorToolsTabs />
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Provider tool reviews</h1>
          <p className="text-body-13 text-02">One maker&apos;s own APIs waiting to be listed in the catalogue. You approve exactly the content you read.</p>
        </div>
        <Segmented value={show} onValueChange={(v) => setShow(v as "pending" | "all")} aria-label="Show" className="inline-flex rounded-md bg-03 p-0.5">
          <SegmentedItem value="pending">Waiting</SegmentedItem>
          <SegmentedItem value="all">Decided too</SegmentedItem>
        </Segmented>
      </header>
      {!mayReviewTools(me.roles) ? <p className="text-body-13 text-03">You can read reviews. Deciding needs an Adjudicator, a Lead adjudicator or a Policy author.</p> : null}
      {queue.isPending ? (
        <PageState kind="loading" rows={4} label="Loading reviews" />
      ) : queue.isError ? (
        <PageState kind="error" description="The review queue could not be loaded." onRetry={() => void queue.refetch()} code={queue.error instanceof ApiError ? queue.error.code : null} />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title={show === "pending" ? "Nothing waiting for review" : "No reviews yet"} description="Providers submit their own APIs for the catalogue from their console." />
      ) : (
        <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01" data-testid="review-queue">
          {rows.map((row) => (
            <li key={`${row.toolId}:${row.reviewVersion ?? ""}`}>
              <Link href={routes.operatorReview(row.toolId)} className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{row.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-body-xs text-03">
                    <Chip tone={row.kind === "CHANGE" ? "primary" : "neutral"}>{REVIEW_KIND_LABEL[row.kind] ?? row.kind}</Chip>
                    {row.reviewSemver ? <span>v{row.reviewSemver}</span> : null}
                    <span>· {row.category}</span>
                    {row.status === "PENDING" ? (
                      row.submittedAt ? (
                        <span>
                          · sent <UtcTime value={row.submittedAt} relative midSentence />
                        </span>
                      ) : null
                    ) : (
                      <Chip tone={row.status === "APPROVED" ? "success" : "warning"}>{row.status === "APPROVED" ? "Approved" : row.status === "REJECTED" ? "Rejected" : row.status}</Chip>
                    )}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-03" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function OperatorReviewsPage() {
  return (
    <React.Suspense fallback={null}>
      <ReviewsScreen />
    </React.Suspense>
  );
}
