"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { DASH, count } from "@/features/g34a/stats";
import { replyBadge, TOOL_REQUEST_STATUS_LABEL } from "@/features/provider-tool-requests/due";
import { REPLY_PROMISE } from "@/features/provider-tool-requests/request-sheet";
import { isToolRequestTerminal } from "@/features/provider-tool-requests/state";
import { isLinkableUrl } from "@/features/provider-tool-requests/url";
import { getToolRequest } from "@/services/provider-tool-requests.service";
import { useSearchParam } from "@/hooks/useSearchParam";

/**
 * One tool request — route `/provider/tool-requests/[id]`.
 *
 * No design frame draws this route; the design covers the list/form screen
 * only. Built to match its panel/typography conventions rather than a
 * second design source. Read-only: there is no `PATCH` on
 * `ToolRequestsController` and answering a ticket is an operator action on a
 * different surface — this screen has no status controls, by design (per the
 * task brief: "The provider can only file and read").
 *
 * A cross-tenant id and a nonexistent one both 404
 * `PROVIDER_TOOL_REQUEST_NOT_FOUND` — rendered identically, per the API
 * contract's "not found and not yours must render the same".
 */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex w-full items-start justify-between gap-4 border-b border-01 py-3 last:border-b-0">
      <span className="text-body-sm text-03">{label}</span>
      <span className="min-w-0 flex-1 text-right font-mono text-mono-13 text-01">{value}</span>
    </div>
  );
}

export default function ToolRequestDetailPage() {
  const id = useSearchParam("id");
  const [now] = React.useState(() => Date.now());

  const requestQuery = useQuery({
    queryKey: ["provider", "tool-requests", "detail", id],
    queryFn: () => getToolRequest(id),
    retry: 0,
  });

  if (requestQuery.isError) {
    return (
      <PageState
        kind="error"
        title="This request could not be opened"
        description="It may have been removed, or it belongs to another account."
        onRetry={() => void requestQuery.refetch()}
      />
    );
  }

  const request = requestQuery.data;
  const terminal = request ? isToolRequestTerminal(request.status) : false;

  return (
    <>
      <header className="flex w-full flex-col items-start gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" />} asChild>
          <Link href="/provider/tool-requests">Back to requests</Link>
        </Button>
        <h1 className="truncate text-heading-md text-01">{request ? request.title : "Tool request"}</h1>
        {request ? (
          <p className="text-body-sm text-02">
            {TOOL_REQUEST_STATUS_LABEL[request.status]}
            {(() => {
              const badge = replyBadge(request, now);
              return badge ? ` · ${badge.label}` : "";
            })()}
            {request.status === "OPEN" ? `. ${REPLY_PROMISE}` : ""}
          </p>
        ) : null}
      </header>

      {!request ? <PageState kind="loading" rows={4} label="Loading this request" /> : null}

      {request ? (
        <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
          <Panel className="w-full min-w-0 flex-1">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>What was filed</PanelTitle>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-4 p-4 tablet:p-5">
              <p className="whitespace-pre-wrap text-body-sm leading-[1.6] text-01">
                {request.description}
              </p>

              {request.upstreamUrl && !isLinkableUrl(request.upstreamUrl) ? (
                <span className="w-fit max-w-full break-all font-mono text-mono-13 text-02">
                  {request.upstreamUrl}
                </span>
              ) : request.upstreamUrl ? (
                <a
                  href={request.upstreamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-fit truncate font-mono text-mono-13 text-primary-600 hover:underline"
                >
                  {request.upstreamUrl}
                </a>
              ) : null}

              {terminal ? (
                <div className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-[13px]">
                  <span className="text-label-13 text-01">
                    {request.status === "ACCEPTED" ? "Accepted" : "Declined"}
                  </span>
                  <span className="text-body-13 text-02">{request.resolutionNote ?? DASH}</span>
                </div>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel className="w-full tablet:w-[380px] tablet:shrink-0">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Ticket</PanelTitle>
                <PanelDescription>named owner, stated turnaround</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="p-4 tablet:p-5">
              <Row label="Handled by" value={request.ownerOperatorId ? "The Assay team" : "Not assigned yet"} />
              <Row
                label="First response due"
                value={<LocalTime value={request.firstResponseDueAt} />}
              />
              <Row
                label="First responded"
                value={request.firstRespondedAt ? <LocalTime value={request.firstRespondedAt} /> : DASH}
              />
              <Row
                label="Expected monthly calls"
                value={count(request.expectedMonthlyCalls)}
              />
              <Row label="Filed" value={<LocalTime value={request.createdAt} />} />
              <Row
                label="Closed"
                value={request.closedAt ? <LocalTime value={request.closedAt} /> : DASH}
              />
            </PanelBody>
          </Panel>
        </section>
      ) : null}
    </>
  );
}
