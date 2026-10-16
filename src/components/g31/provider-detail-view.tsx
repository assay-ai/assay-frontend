"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FailsOftenChip, Fact, ObservedFailuresLabel, OfferPrice, VerifiedMark } from "@/components/explorer/explorer-bits";
import { ToolAccessControl } from "@/components/explorer/tool-access-control";
import { EntityName } from "@/components/patterns/entity-name";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Term } from "@/components/patterns/term";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { callOutcome } from "@/features/buyer/call-outcome";
import { failRateLabel, failsOften, formatCallPrice, offerLine, plural, stakeSummary } from "@/features/explorer/explorer-text";
import { useChainName } from "@/hooks/useChainName";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getCatalogueProvider } from "@/services/catalogue.service";
import { formatMoney } from "@/utils/money";

import { useCatalogue } from "./use-catalogue";

/**
 * Explore › provider (`/explore/providers/view?id=`): who they are, how often
 * their results fail our checks (measured by Assay, not claimed), the stake
 * they put up per chain, and each tool they serve with Allow / Block for your
 * agents — the same allowlist as Budgets. Your own recent calls to them sit
 * below, each opening its receipt.
 */
export function ProviderDetailView({ providerId }: { providerId: string }) {
  const chainName = useChainName();
  const { calls, tools } = useCatalogue();
  const allToolIds = React.useMemo(() => tools.map((t) => t.toolId), [tools]);

  const entry = useQuery({
    queryKey: ["catalogue", "provider", providerId],
    enabled: Boolean(providerId),
    retry: false,
    staleTime: 60 * 1000,
    queryFn: () => getCatalogueProvider(providerId),
  });

  const own = React.useMemo(() => calls.filter((c) => c.providerId === providerId).slice(0, 10), [calls, providerId]);

  const back = (
    <Link href="/explore" className="inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      All tools
    </Link>
  );

  if (!providerId || (entry.error instanceof ApiError && entry.error.status === 404)) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5 tablet:px-7">
        {back}
        <PageState
          kind="empty"
          title="We could not find this provider"
          description="They may have left the platform."
          action={{ label: "See all tools", href: "/explore" }}
        />
      </div>
    );
  }
  if (entry.isPending) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5 tablet:px-7">
        {back}
        <PageState kind="loading" rows={4} label="Loading the provider" />
      </div>
    );
  }
  if (entry.isError) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5 tablet:px-7">
        {back}
        <PageState
          kind="error"
          title="This provider could not be loaded"
          description={plainError(entry.error instanceof ApiError ? entry.error.code : "ERR_NETWORK")}
          onRetry={() => void entry.refetch()}
          code={entry.error instanceof ApiError ? entry.error.code : null}
        />
      </div>
    );
  }

  const provider = entry.data;

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:gap-4 tablet:px-7 tablet:py-[18px]">
      {back}

      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-heading-md text-01">{provider.legalName}</h1>
          <VerifiedMark verified={provider.verified} interactive />
          {failsOften(provider.quality) ? <FailsOftenChip /> : null}
        </div>
        <p className="text-body-13 text-02">Serves {plural(provider.tools.length, "tool")} on Assay.</p>
      </header>

      <section className="grid grid-cols-1 gap-4 rounded-xl border border-01 bg-01 p-4 tablet:grid-cols-3 tablet:p-5">
        <Fact label={<ObservedFailuresLabel interactive />}>{failRateLabel(provider.quality)}</Fact>
        <Fact label="Stake at risk">{stakeSummary(provider.stake, chainName)}</Fact>
        <Fact label="Cheapest call">{provider.fromPrice ? formatCallPrice(provider.fromPrice) : "—"}</Fact>
        <p className="text-body-xs text-03 tablet:col-span-3">
          Failures are measured by Assay on real calls. A provider that fails more often than it promised loses part of
          its <Term k="stake">stake</Term>, and part of that goes to the buyers it served badly.
        </p>
      </section>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Tools they serve</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {provider.tools.length === 0 ? (
            <p className="px-5 py-4 text-body-13 text-02">No tools listed right now.</p>
          ) : (
            <ul className="flex flex-col">
              {provider.tools.map((tool) => (
                <li key={tool.toolId} className="flex flex-col gap-2.5 border-b border-01 px-4 py-3 last:border-b-0 tablet:flex-row tablet:items-center tablet:gap-4 tablet:px-5">
                  <Link href={routes.exploreTool(tool.toolId)} className="flex min-w-0 flex-1 flex-col gap-1 hover:underline">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
                    </span>
                    {/* This provider's own listing: one price, its free calls first (as on the public page). */}
                    <OfferPrice
                      offer={offerLine({
                        mode: tool.pricingMode,
                        range: tool.price ? { from: tool.price, held: tool.price, differs: false } : null,
                        freeCallsPerDay: tool.freeCallsPerAgentPerDay,
                      })}
                    />
                  </Link>
                  <ToolAccessControl toolId={tool.toolId} toolName={tool.name} allToolIds={allToolIds} />
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {own.length > 0 ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Your recent calls to them</PanelTitle>
            </PanelTitles>
          </PanelHeader>
          <PanelBody>
            <ul className="flex flex-col">
              {own.map((call) => (
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
                        <StatusChip status={callOutcome(call)} />
                        <LocalTime value={call.createdAt} />
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-mono-13 text-01">{callOutcome(call) === "checking"
                        ? `${formatMoney(call.price, { decimals: 4 })} held`
                        : callOutcome(call) === "owed"
                          ? `${formatMoney(call.price, { decimals: 4 })} owed`
                          : formatMoney(call.charged, { decimals: 4 })}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                  </Link>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
