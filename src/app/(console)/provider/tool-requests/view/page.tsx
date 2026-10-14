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
import { DASH, count, stampUtc } from "@/features/g34a/stats";
import { isToolRequestTerminal, toolRequestOwnerLabel, toolRequestStateLine } from "@/features/provider-tool-requests/state";
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

  const requestQuery = useQuery({
    queryKey: ["provider", "tool-requests", "detail", id],
    queryFn: () => getToolRequest(id),
    retry: 0,
  });

  if (requestQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This request could not be loaded. It may belong to another organisation, or the id may not
        exist.
      </p>
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
        <h1 className="truncate text-heading-md text-01">{request ? request.title : "Loading…"}</h1>
        {request ? <p className="text-body-sm text-02">{toolRequestStateLine(request)}</p> : null}
      </header>

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
              <Row label="Owner" value={toolRequestOwnerLabel(request)} />
              <Row
                label="First response due"
                value={`${stampUtc(request.firstResponseDueAt)} UTC`}
              />
              <Row
                label="First responded"
                value={request.firstRespondedAt ? `${stampUtc(request.firstRespondedAt)} UTC` : DASH}
              />
              <Row
                label="Expected monthly calls"
                value={count(request.expectedMonthlyCalls)}
              />
              <Row label="Filed" value={`${stampUtc(request.createdAt)} UTC`} />
              <Row
                label="Closed"
                value={request.closedAt ? `${stampUtc(request.closedAt)} UTC` : DASH}
              />
            </PanelBody>
          </Panel>
        </section>
      ) : null}
    </>
  );
}
