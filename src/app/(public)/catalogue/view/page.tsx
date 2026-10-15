"use client";

import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FailsOftenChip, Fact, FreeTierBadge, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { NotChargedProof } from "@/components/explorer/not-charged-proof";
import { StartFreeCta } from "@/components/explorer/start-free";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import {
  checkSentences,
  failRateLabel,
  failsOften,
  heldPriceSentence,
  notTakingPaidCalls,
  priceRange,
  routingNotes,
  formatCallPrice,
  freeTierLabel,
  priceSentence,
  smallestFreeAllowance,
  stakeSummary,
} from "@/features/explorer/explorer-text";
import {
  publicErrorText,
  usePublicProviderDetails,
  usePublicProviders,
  usePublicTools,
} from "@/features/explorer/use-public-explorer";
import { useChainName } from "@/hooks/useChainName";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";

/**
 * One tool, public — route `/catalogue/view?tool=<id or name>`.
 *
 * Answers a newcomer's questions in order: what it does, what a call costs and
 * when you pay, what is checked, who serves it (with their failure record and
 * stake), and the recent calls that were not charged.
 */

function ToolPage() {
  const key = useSearchParam("tool");
  const tools = usePublicTools();
  const providers = usePublicProviders();
  const chainName = useChainName();

  const tool = React.useMemo(
    () => tools.data?.tools.find((t) => t.id === key) ?? tools.data?.tools.find((t) => t.name === key) ?? null,
    [tools.data, key],
  );
  const serving = React.useMemo(
    () => (tool ? (providers.data?.providers ?? []).filter((p) => p.toolIds.includes(tool.id)) : []),
    [providers.data, tool],
  );
  const details = usePublicProviderDetails(serving.map((p) => p.providerId));
  const listingOf = (providerId: string) =>
    details
      .map((d) => d.data)
      .find((d) => d?.providerId === providerId)
      ?.tools.find((t) => t.toolId === tool?.id);
  const freeAllowance = smallestFreeAllowance(serving.map((p) => listingOf(p.providerId)?.freeCallsPerAgentPerDay));

  if (tools.isPending) {
    return <PageState kind="loading" rows={4} label="Loading the tool" />;
  }
  if (tools.isError) {
    return (
      <PageState
        kind="error"
        title="This tool could not be loaded"
        description={publicErrorText(tools.error, "this tool")}
        onRetry={() => void tools.refetch()}
        code={tools.error instanceof ApiError ? tools.error.code : null}
      />
    );
  }
  if (!tool) {
    return (
      <PageState
        kind="empty"
        title="We could not find that tool"
        description="It may have been renamed or is no longer listed."
        action={{ label: "See all tools", href: "/catalogue" }}
      />
    );
  }

  const settles = tool.settlementChains ?? [];
  // What the providers charge, against what a call is held for (the dearest
  // provider that can take it now). See `priceRange`.
  const range = priceRange(tool.price, [tool.fromPrice, ...serving.map((p) => listingOf(p.providerId)?.price)]);
  const rangeLine = range ? heldPriceSentence(range) : null;

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-all font-mono text-heading-md text-01">{tool.name}</h1>
          <FreeTierBadge label={freeTierLabel(tool.pricingMode, freeAllowance)} />
          {tool.routable ? null : <UnavailableTag />}
        </div>
        {tool.description ? <p className="max-w-[760px] text-body-md text-02">{tool.description}</p> : null}
      </header>

      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
          <h2 className="text-label-md text-01">What a call costs</h2>
          <p className="font-mono text-mono-xl font-semibold text-01">
            {range?.differs ? <span className="mr-1.5 font-sans text-body-13 font-normal text-03">from</span> : null}
            {range ? formatCallPrice(range.from) : tool.price ? formatCallPrice(tool.price) : "—"}
            {tool.price ? <span className="ml-1.5 font-sans text-body-13 font-normal text-03">per call</span> : null}
          </p>
          <p className="text-body-13 text-02">
            {rangeLine ?? priceSentence({ mode: tool.pricingMode, price: tool.price, freeCallsPerDay: freeAllowance })}
          </p>
          {settles.length > 0 ? (
            <p className="text-body-xs text-03">
              Paid on {settles.map((c) => chainName(c)).join(", ")}.{" "}
              {freeAllowance ? "You need funds there once the free calls run out." : "You pay from funds you hold there."}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
          <h2 className="text-label-md text-01">What is checked</h2>
          <ul className="flex flex-col gap-2">
            {checkSentences(tool.tier).map((line) => (
              <li key={line} className="flex items-start gap-2 text-body-13 text-01">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-500" />
                {line}
              </li>
            ))}
            <li className="flex items-start gap-2 text-body-13 text-01">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-500" />
              If the result fails, the held amount goes straight back. You never have to ask for a refund.
            </li>
          </ul>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-label-md text-01">Who serves it</h2>
        {providers.isPending ? (
          <PageState kind="loading" rows={2} label="Loading providers" />
        ) : providers.isError ? (
          <PageState
            kind="error"
            title="Providers could not be loaded"
            description={publicErrorText(providers.error, "the providers")}
            onRetry={() => void providers.refetch()}
          />
        ) : serving.length === 0 ? (
          <PageState
            kind="empty"
            title="Nobody serves this tool yet"
            description="The first provider to list it gets every call agents make to it."
            action={{ label: "List it yourself", href: "/why-list-here" }}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
            {serving.map((provider) => {
              const listing = listingOf(provider.providerId);
              // Priced above the hold: the router's quote is the dearest provider
              // that can take a call now, so this one is not being routed to.
              const notRouted = notTakingPaidCalls(tool.price, listing?.price);
              return (
                <li key={provider.providerId}>
                  <Link
                    href={routes.publicProvider(provider.providerId)}
                    className="group flex w-full items-start gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 tablet:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] tablet:gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-label-sm text-01">{provider.name}</span>
                          <VerifiedMark verified={provider.verified} />
                          {failsOften(provider.quality) ? <FailsOftenChip /> : null}
                        </span>
                        <span className="text-body-xs text-03">
                          {listing ? `${formatCallPrice(listing.price)} per call` : ""}
                          {listing?.freeCallsPerAgentPerDay ? ` · ${listing.freeCallsPerAgentPerDay} free calls/day` : ""}
                          {notRouted ? " · not taking paid calls right now" : ""}
                        </span>
                      </div>
                      <Fact label="Observed failures">{failRateLabel(provider.quality)}</Fact>
                      <Fact label="Stake at risk">{stakeSummary(provider.stake, chainName)}</Fact>
                    </div>
                    <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-03 group-hover:text-02" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {serving.length > 0
          ? routingNotes(
              tool.price,
              serving.map((p) => ({ name: p.name, price: listingOf(p.providerId)?.price, quality: p.quality })),
              chainName,
            ).map((note) => (
              <p key={note} className="text-body-13 text-02" data-testid="routing-note">
                {note}
              </p>
            ))
          : null}
        <p className="text-body-xs text-03">
          A provider who fails more often than they promised loses part of their <Term k="stake">stake</Term>, and part
          of it goes to the buyers they served badly.
        </p>
      </section>

      <NotChargedProof toolId={tool.id} limit={5} />

      <section className="flex flex-col gap-3 rounded-xl border border-primary-20 bg-primary-10 p-4 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-5">
        <div className="flex flex-col gap-1">
          <p className="text-label-md text-01">Let your agent use {tool.name}</p>
          <p className="text-body-13 text-02">
            {freeAllowance
              ? `Sign up, create an agent key, and the first ${freeAllowance} calls a day are free — no deposit needed.`
              : "Sign up, create an agent key and add funds. You pay only for results that pass."}
          </p>
        </div>
        <StartFreeCta next={routes.exploreTool(tool.id)} className="tablet:items-end" />
      </section>
    </>
  );
}

export default function PublicToolPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      <Link href="/catalogue" className="inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        All tools
      </Link>
      <React.Suspense fallback={<PageState kind="loading" rows={4} label="Loading the tool" />}>
        <ToolPage />
      </React.Suspense>
    </div>
  );
}
