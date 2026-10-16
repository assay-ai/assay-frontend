"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/g31/chrome";
import { EntityName } from "@/components/patterns/entity-name";
import { callPaymentNote } from "@/features/buyer-debt/debt-copy";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import {
  CALLS_FILTERS,
  callOutcome,
  matchesFilter,
  parseCallsFilter,
  statusesFor,
  type CallsFilter,
} from "@/features/buyer/call-outcome";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { listToolCalls } from "@/services/tool-calls.service";
import { cn } from "@/utils";
import { formatMoney, notCharged, toDecimal } from "@/utils/money";

/**
 * Activity › Calls — every call, newest first, by tool name. Status chips
 * (All · Charged · Not charged · Free) and a tool filter live in the URL
 * (`?status=not-charged&tool=<id>`), so Not charged and Overview can link
 * straight to a filtered list. A row opens the receipt.
 *
 * No agent column or filter: `GET /tool-calls` neither returns nor filters by
 * agent. The provider that served the call is shown when it is known.
 */

const PAGE = 50;

function CallsList() {
  const params = useSearchParams();
  const router = useRouter();
  const filter = parseCallsFilter(params.get("status"));
  const toolId = params.get("tool") || null;
  const names = useEntityNames({ kinds: ["tool", "provider"] });

  const setParams = React.useCallback(
    (next: { status?: CallsFilter; tool?: string | null }) => {
      const status = next.status ?? filter;
      const tool = next.tool === undefined ? toolId : next.tool;
      router.replace(routes.calls({ status: status === "all" ? undefined : status, tool: tool ?? undefined }), {
        scroll: false,
      });
    },
    [filter, toolId, router],
  );

  const query = useInfiniteQuery({
    queryKey: ["tool-calls", "list", filter, toolId],
    queryFn: ({ pageParam }) =>
      listToolCalls({
        limit: PAGE,
        status: statusesFor(filter),
        toolId: toolId ?? undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo?.hasMore ? (last.pageInfo.nextCursor ?? null) : null),
    retry: 0,
  });

  const calls = React.useMemo(
    () =>
      (query.data?.pages ?? [])
        .flatMap((page) => page.items ?? [])
        .filter((call) => matchesFilter(call, filter) && (!toolId || call.toolId === toolId)),
    [query.data, filter, toolId],
  );

  const toolOptions = React.useMemo(
    () => [...names.index.tool.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    [names.index],
  );

  const filtered = filter !== "all" || Boolean(toolId);

  return (
    <>
      <div className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-end tablet:justify-between">
        <div role="radiogroup" aria-label="Show calls" className="flex flex-wrap gap-2">
          {CALLS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={filter === option.value}
              onClick={() => setParams({ status: option.value })}
              className={cn(
                "rounded-full border px-3 py-1.5 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                filter === option.value ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="w-full tablet:w-[280px]">
          <EntityPicker
            label="Tool"
            value={toolId}
            onChange={(id) => setParams({ tool: id })}
            options={toolOptions}
            selectedLabel={toolId ? names.name("tool", toolId) : undefined}
            placeholder="All tools"
          />
        </div>
      </div>

      {query.isPending ? (
        <PageState kind="loading" rows={6} label="Loading your calls" />
      ) : query.isError ? (
        <PageState
          kind="error"
          description={plainError(query.error instanceof ApiError ? query.error.code : "ERR_NETWORK")}
          onRetry={() => void query.refetch()}
          code={query.error instanceof ApiError ? query.error.code : null}
          details={query.error.message}
        />
      ) : calls.length === 0 ? (
        !filtered ? (
          <PageState
            kind="empty"
            title="No calls yet"
            description="Once your agent calls a tool through Assay, each call shows here with what it cost."
            action={{ label: "Connect your agent", href: "/connect" }}
          />
        ) : (
          <PageState
            kind="empty"
            title={
              filter === "charged"
                ? "No charged calls"
                : filter === "not-charged"
                  ? "Nothing went uncharged"
                  : filter === "free"
                    ? "No free calls"
                    : "No calls to this tool"
            }
            description={
              filter === "not-charged"
                ? "Every call here passed our checks, so each was charged at its listed price."
                : filter === "free"
                  ? "Free calls appear here when your agent uses a tool's free tier."
                  : "Nothing matches these filters."
            }
            action={{ label: "Show all calls", onClick: () => router.replace(routes.calls(), { scroll: false }) }}
          />
        )
      ) : (
        <>
          <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-soft">
            {calls.map((call) => {
              const outcome = callOutcome(call);
              const uncharged = notCharged(call.price, call.charged);
              // Buyer debt or a forfeited payment: say why, beside the verdict.
              const paymentNote = callPaymentNote(call);
              return (
                <li key={call.intentId} className="border-b border-01 last:border-b-0">
                  <Link
                    href={routes.receipt(call.intentId)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate font-mono text-mono-13 font-semibold text-01">
                        <EntityName kind="tool" id={call.toolId} copyable={false} />
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03">
                        <StatusChip status={outcome} />
                        <span>
                          {outcome === "checking" ? "started " : null}
                          <LocalTime value={call.createdAt} relative />
                        </span>
                        {names.lookup("provider", call.providerId) ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{names.lookup("provider", call.providerId)}</span>
                          </>
                        ) : null}
                      </span>
                      {paymentNote ? (
                        <span
                          className={
                            outcome === "owed" ? "text-body-xs text-warning-700" : "text-body-xs text-03"
                          }
                        >
                          {paymentNote}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-mono text-mono-13 font-semibold text-01">
                        {outcome === "free"
                              ? "Free"
                              : outcome === "checking"
                                ? `${formatMoney(call.price, { decimals: 4 })} held`
                                : outcome === "owed"
                                  ? `${formatMoney(call.price, { decimals: 4 })} owed`
                                  : formatMoney(call.charged, { decimals: 4 })}
                      </span>
                      {outcome !== "checking" && outcome !== "owed" && toDecimal(uncharged).gt(0) ? (
                        <span className="font-mono text-mono-xs text-teal-600">
                          {formatMoney(uncharged, { decimals: 4 })} not charged
                        </span>
                      ) : null}
                    </div>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              className="self-center"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Show more calls
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

export default function CallsPage() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Calls" />
      <p className="-mt-2 text-body-13 text-03">Every call your agents made, newest first. Open one to see why it was or was not charged.</p>
      <React.Suspense fallback={<PageState kind="loading" rows={6} label="Loading your calls" />}>
        <CallsList />
      </React.Suspense>
    </div>
  );
}
