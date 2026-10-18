"use client";

import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PROVIDER_TOOLS_TABS } from "@/components/layout/provider-nav-config";
import { SectionTabs } from "@/components/layout/section-tabs";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { replyBadge, TOOL_REQUEST_STATUS_LABEL } from "@/features/provider-tool-requests/due";
import { REPLY_PROMISE, TOOL_REQUESTS_LIST_KEY, ToolRequestSheet } from "@/features/provider-tool-requests/request-sheet";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listToolRequests } from "@/services/provider-tool-requests.service";
import { cn } from "@/utils";

/**
 * Tool requests: ask Assay to add a tool the catalogue does not have yet, and
 * follow the ones you asked for. Filing is a sheet (also opened from the
 * listing wizard's tool step); each open request shows when the first reply
 * is due, or how late it is.
 */

const BADGE_TONE = {
  neutral: "bg-03 text-02",
  warning: "bg-warning-10 text-warning-700",
  danger: "bg-danger-10 text-danger-700",
} as const;

export default function ToolRequestsPage() {
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const listQuery = useQuery({
    queryKey: TOOL_REQUESTS_LIST_KEY,
    queryFn: () => listToolRequests({ limit: 20 }),
    retry: 0,
  });
  const items = listQuery.data?.items ?? [];

  return (
    <>
      <SectionTabs tabs={PROVIDER_TOOLS_TABS} label="Listings" />
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Tool requests</h1>
          <p className="text-body-13 text-03">
            Missing a tool your API could provide? Ask the Assay team to add it to the catalogue, so others can serve it
            too and buyers get a backup. {REPLY_PROMISE} Want it today?{" "}
            <Link href="/provider/apis" className="text-primary-600 hover:underline">
              Publish your API
            </Link>
            : a new tool that only you serve.
          </p>
        </div>
        <Button icon={<Send aria-hidden="true" />} onClick={() => setOpen(true)}>
          Request a tool
        </Button>
      </header>

      {listQuery.isPending ? (
        <PageState kind="loading" rows={3} label="Loading your requests" />
      ) : listQuery.isError ? (
        <PageState
          kind="error"
          description="Your requests could not be loaded."
          onRetry={() => void listQuery.refetch()}
          code={listQuery.error instanceof ApiError ? listQuery.error.code : null}
        />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title="No requests yet"
          description={`Tell us the tool's name and what it returns. ${REPLY_PROMISE}`}
          action={{ label: "Request a tool", onClick: () => setOpen(true) }}
        />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-lg border border-01 bg-01">
          {items.map((request) => {
            const badge = now === null ? null : replyBadge(request, now);
            return (
              <li key={request.id} className="border-t border-01 first:border-t-0">
                <Link
                  href={routes.toolRequest(request.id)}
                  className="flex flex-col gap-1 px-4 py-3.5 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-label-sm text-01">{request.title}</span>
                    <span className="text-body-xs text-03">
                      Sent <UtcTime value={request.createdAt} />
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body-13 text-02">{TOOL_REQUEST_STATUS_LABEL[request.status]}</span>
                    {badge ? (
                      <span className={cn("rounded-full px-2 py-0.5 text-label-xs", BADGE_TONE[badge.tone])}>{badge.label}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <ToolRequestSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
