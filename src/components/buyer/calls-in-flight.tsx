"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { EntityName } from "@/components/patterns/entity-name";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { IN_FLIGHT_STATUSES } from "@/features/buyer/call-outcome";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listToolCalls } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

/**
 * Calls whose money is held while the result is checked — nothing to decide,
 * just where held money sits right now. Refreshes every 15 s. Hidden entirely
 * when nothing is in flight, so a quiet account does not see an empty panel.
 */
export function CallsInFlight() {
  const query = useQuery({
    queryKey: ["tool-calls", "in-flight"],
    queryFn: () => listToolCalls({ status: [...IN_FLIGHT_STATUSES], limit: 20 }),
    retry: 0,
    refetchInterval: 15_000,
  });
  const items = (query.data?.items ?? []).filter((c) => (IN_FLIGHT_STATUSES as readonly string[]).includes(c.status));

  if (query.isPending || (query.isSuccess && items.length === 0)) return null;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Calls in flight</PanelTitle>
          <PanelDescription className="whitespace-normal">
            Money is held while each result is checked. Nothing here needs you.
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody>
        {query.isError ? (
          <PageState
            kind="error"
            bare
            className="px-5"
            title="Calls in flight could not be read"
            description="This does not mean there are none. Try again in a moment."
            onRetry={() => void query.refetch()}
            code={query.error instanceof ApiError ? query.error.code : null}
          />
        ) : (
          <ul className="flex flex-col">
            {items.map((call) => (
              <li key={call.intentId} className="border-b border-01 last:border-b-0">
                <Link
                  href={routes.receipt(call.intentId)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-mono text-mono-13 font-semibold text-01">
                      <EntityName kind="tool" id={call.toolId} copyable={false} />
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-body-xs text-03">
                      <StatusChip status="checking" />
                      <LocalTime value={call.createdAt} />
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-mono-13 text-01">{formatMoney(call.price, { decimals: 4 })} held</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
