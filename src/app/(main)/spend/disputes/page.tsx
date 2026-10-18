"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/g31/chrome";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { buyerStatus, DISPUTE_COPY } from "@/features/call-disputes/model";
import { callDisputeKeys, DisputeChip, useNow } from "@/features/call-disputes/ui";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listCallDisputes } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";

/**
 * Reports — route `/spend/disputes`: every call this organization reported as
 * a bad result, newest first, with where each stands (waiting for the
 * provider, waiting for a decision, upheld and refunded, rejected). A report
 * is filed from the call's receipt.
 */
export default function ReportsPage() {
  const names = useEntityNames({ kinds: ["tool"] });
  const now = useNow();
  const list = useInfiniteQuery({
    queryKey: [...callDisputeKeys.buyer, "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listCallDisputes({ cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    retry: 0,
  });
  const items = React.useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Reports" />
      <p className="-mt-2 text-body-13 text-03">
        Calls you reported as a bad result. Report one from its receipt under Calls: inside the 1-hour hold, an upheld report is refunded in full. {DISPUTE_COPY.limit}
      </p>
      {list.isPending ? (
        <PageState kind="loading" rows={4} label="Loading your reports" />
      ) : list.isError ? (
        <PageState kind="error" description="Your reports could not be loaded." onRetry={() => void list.refetch()} code={list.error instanceof ApiError ? list.error.code : null} />
      ) : items.length === 0 ? (
        <PageState kind="empty" title="No reports" description="When a call returns a bad result, open it under Calls and choose “Report a bad result”." action={{ label: "Open Calls", href: routes.calls() }} />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01" data-testid="report-list">
          {items.map((d) => {
            const status = buyerStatus(d, now);
            return (
              <li key={d.id} className="border-t border-01 first:border-t-0">
                <Link href={routes.callDispute(d.id)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:bg-02 focus-visible:outline-none">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-all font-mono text-mono-13 text-01">{d.toolId ? names.name("tool", d.toolId) : "A call"}</span>
                    <span className="text-body-xs text-03">
                      {d.reasonLabel} · reported <UtcTime value={d.createdAt} midSentence />
                      {d.amount ? ` · ${formatMoney(d.amount, { decimals: 4 })}` : ""}
                    </span>
                  </span>
                  <DisputeChip view={status} />
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}
