"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PROVIDER_PENALTIES_TABS } from "@/components/layout/provider-nav-config";
import { SectionTabs } from "@/components/layout/section-tabs";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { providerStatus, replyDueAt } from "@/features/call-disputes/model";
import { callDisputeKeys, DisputeChip, useNow } from "@/features/call-disputes/ui";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listProviderCallDisputes, type CallDisputeState } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";

/**
 * Bad-result reports — route `/provider/call-disputes`: buyers' reports about
 * calls you served. Reply once within 24 hours; a report you stay silent on
 * is upheld automatically at 72 hours. The buyer is never named.
 */

const FILTERS: { id: "open" | "all"; label: string; state: CallDisputeState[] | undefined }[] = [
  { id: "open", label: "Open", state: ["OPEN"] },
  { id: "all", label: "All", state: undefined },
];

export default function ProviderReportsPage() {
  const [filter, setFilter] = React.useState<"open" | "all">("open");
  const names = useProviderToolNames();
  const now = useNow();
  const state = FILTERS.find((f) => f.id === filter)!.state;
  const list = useInfiniteQuery({
    queryKey: [...callDisputeKeys.provider, "list", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listProviderCallDisputes({ state, cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    retry: 0,
  });
  const items = React.useMemo(
    () => [...(list.data?.pages ?? []).flatMap((p) => p.items)].sort((a, b) => Number(b.canRespond) - Number(a.canRespond) || Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [list.data],
  );

  return (
    <>
      <SectionTabs tabs={PROVIDER_PENALTIES_TABS} label="Penalties" />
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Bad-result reports</h1>
          <p className="text-body-13 text-03">
            Buyers&apos; reports about calls you served. Reply once within 24 hours: if you stay silent, the report is upheld automatically at 72 hours and the held payment goes back to the buyer.
          </p>
        </div>
        <Segmented value={filter} onValueChange={(v) => setFilter(v as "open" | "all")} aria-label="Show" className="inline-flex rounded-md bg-03 p-0.5">
          {FILTERS.map((f) => (
            <SegmentedItem key={f.id} value={f.id}>
              {f.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </header>
      {list.isPending ? (
        <PageState kind="loading" rows={4} label="Loading reports" />
      ) : list.isError ? (
        <PageState kind="error" description="The reports could not be loaded." onRetry={() => void list.refetch()} code={list.error instanceof ApiError ? list.error.code : null} />
      ) : items.length === 0 ? (
        <PageState kind="empty" title={filter === "open" ? "No open reports" : "No reports yet"} description="When a buyer reports a bad result on a call you served, it lands here and in your Inbox." />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-lg border border-01 bg-01" data-testid="provider-report-list">
          {items.map((d) => {
            const status = providerStatus(d, now);
            return (
              <li key={d.id} className="border-t border-01 first:border-t-0">
                <Link href={routes.providerCallDispute(d.id)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:bg-02 focus-visible:outline-none">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-label-sm text-01">{names.toolName(d.toolId) ?? "A call you served"}</span>
                    <span className="text-body-xs text-03">
                      {d.reasonLabel} · reported <UtcTime value={d.createdAt} midSentence />
                      {d.amount ? ` · ${formatMoney(d.amount, { decimals: 4 })}` : ""}
                    </span>
                    {d.canRespond ? (
                      <span className="text-body-xs text-warning-700">
                        Reply by <UtcTime value={replyDueAt(d)} midSentence />
                      </span>
                    ) : null}
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
    </>
  );
}
