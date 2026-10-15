"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/g31/chrome";
import { EntityName } from "@/components/patterns/entity-name";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { listToolCalls, type ToolCall } from "@/services/tool-calls.service";
import { formatMoney, notCharged, toDecimal } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";

/**
 * Activity › Calls: the latest calls, one row each, by tool name, with what
 * was charged and what was not. A row opens the receipt.
 *
 * The first cut of this tab (the shell's "Calls" tab needs a real page). The
 * buyer rebuild extends it with the Free filter, date range and paging.
 */

type Filter = "all" | "charged" | "not-charged";

const LIMIT = 50;

function callFilter(call: Pick<ToolCall, "price" | "charged">, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "charged") return toDecimal(call.charged).gt(0);
  return toDecimal(notCharged(call.price, call.charged)).gt(0);
}

export default function CallsPage() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const query = useQuery({
    queryKey: ["tool-calls", "latest", LIMIT],
    queryFn: () => listToolCalls({ limit: LIMIT }),
    retry: 0,
    networkMode: "always" as const,
  });

  const calls = (query.data?.items ?? []).filter((call) => callFilter(call, filter));

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Calls" subtitle={`your latest ${LIMIT} calls`} />

      <Segmented value={filter} onValueChange={(value) => setFilter(value as Filter)} className="self-start">
        <SegmentedItem value="all">All</SegmentedItem>
        <SegmentedItem value="charged">Charged</SegmentedItem>
        <SegmentedItem value="not-charged">Not charged</SegmentedItem>
      </Segmented>

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
        filter === "all" ? (
          <PageState
            kind="empty"
            title="No calls yet"
            description="Once your agent calls a tool through Assay, each call shows here with what it cost."
            action={{ label: "Connect your agent", href: "/connect" }}
          />
        ) : (
          <PageState
            kind="empty"
            title={filter === "charged" ? "No charged calls" : "Nothing went uncharged"}
            description={
              filter === "charged"
                ? "None of your latest calls cost anything."
                : "Every one of your latest calls passed our checks, so each was charged at its listed price."
            }
            action={{ label: "Show all calls", onClick: () => setFilter("all") }}
          />
        )
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-soft">
          {calls.map((call) => {
            const verdict = presentVerdict(call.verdict);
            const uncharged = notCharged(call.price, call.charged);
            return (
              <li key={call.intentId} className="border-b border-01 last:border-b-0">
                <Link
                  href={routes.receipt(call.intentId)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2 text-label-sm text-01">
                      <EntityName kind="tool" id={call.toolId} copyable={false} />
                    </span>
                    <span className="truncate text-body-xs text-03">
                      <LocalTime value={call.createdAt} /> · {verdict.shownAs}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="font-mono text-mono-13 font-semibold text-01">
                      {toDecimal(call.price).isZero() ? "Free" : formatMoney(call.charged, { decimals: 4 })}
                    </span>
                    {toDecimal(uncharged).gt(0) ? (
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
      )}
    </div>
  );
}
