"use client";

import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ToolContractSection } from "@/components/contracts/tool-contract";
import { ToolVersionBadges } from "@/components/contracts/version-badges";
import { FailsOftenChip, Fact, ObservedFailuresLabel, OfferPrice, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { BuyerCosts } from "@/components/explorer/buyer-costs";
import { NotChargedProof } from "@/components/explorer/not-charged-proof";
import { StartFreeCta } from "@/components/explorer/start-free";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import {
  chainPriceLines,
  checkSentences,
  failRateLabel,
  orderChainPrices,
  paidOnText,
  listingOfferText,
  normalisedMode,
  failsOften,
  notTakingPaidCalls,
  priceRange,
  routingNotes,
  offerLine,
  costSentence,
  stakeSummary,
} from "@/features/explorer/explorer-text";
import {
  publicErrorText,
  usePublicProviderDetails,
  usePublicProviders,
  usePublicTools,
} from "@/features/explorer/use-public-explorer";
import { mcpToolName } from "@/features/connect/mcp-url";
import { useChainName } from "@/hooks/useChainName";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";

/**
 * One tool, public — route `/catalogue/view?tool=<id>`.
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
    () => tools.data?.tools.find((t) => t.id === key) ?? null,
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
  // The name an agent calls it by, for "Use this tool" (`/connect?tools=`).
  const mcpName = tool ? mcpToolName(tool) : null;
  // A static export cannot set per-tool metadata; name the tool in the tab.
  useDocumentTitle(tool ? `${tool.name}: price and record — Assay` : null);
  // The backend's own figure: free calls a day over every free-capable listing.
  const freeAllowance = tool?.freeCallsPerDay ?? null;

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
  // A buyer pays on one chain, so the price is per chain (D6). Anonymous, the
  // headline is the chain of the tool's own quote; every other chain gets its own line.
  const chainPrices = orderChainPrices(tool.prices, null, tool.price);
  const lead = chainPrices[0] ?? null;
  const held = lead?.price ?? tool.price;
  const nameOf = (providerId: string) => serving.find((p) => p.providerId === providerId)?.name;
  // What the providers charge, against what a call is held for (the dearest
  // provider that can take it now). See `priceRange`.
  // "from" only over more than one listing that can be charged (`paidBindings`).
  const range = priceRange(
    held,
    tool.paidBindings > 1 ? [tool.fromPrice, ...serving.map((p) => listingOf(p.providerId)?.price)] : [],
  );
  // The provider is named only when exactly one eligible listing serves that chain (`listings`).
  const lines = chainPriceLines(chainPrices, { chainName, nameOf, leadIsRange: range?.differs });

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-all font-mono text-heading-md text-01">{tool.name}</h1>
          {tool.routable ? null : <UnavailableTag />}
          <ToolVersionBadges name={tool.name} version={tool.version} versions={tool.versions} deprecatedMajors={tool.deprecatedMajors} replacementName={tool.replacementName} replacementVersion={tool.replacementVersion} />
        </div>
        {tool.description ? <p className="max-w-[760px] text-body-md text-02">{tool.description}</p> : null}
        {tool.kind === "PROVIDER" ? (
          <p className="flex flex-wrap items-center gap-2 text-body-13 text-02" data-testid="maker-facts">
            <span className="rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">One maker&apos;s API{tool.handle ? ` · @${tool.handle}` : ""}</span>
            {tool.notReviewed ? <span className="rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700">Not reviewed</span> : null}
            <span>
              Only its maker serves it, so there is no backup provider.
              {tool.handle ? (
                <>
                  {" "}
                  <Link href={`/toolsets/handle?handle=${encodeURIComponent(tool.handle)}`} className="text-primary-600 hover:underline">
                    More from @{tool.handle}
                  </Link>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
          <h2 className="text-label-md text-01">What a call costs</h2>
          {/* One price line, free first: the free tier and the price together. */}
          <OfferPrice size="lg" offer={offerLine({ mode: tool.pricingMode, range, freeCallsPerDay: freeAllowance })} />
          {lead && range && lines.lead ? (
            <p className="-mt-2 text-body-13 text-02" data-testid="price-chain">
              {lines.lead}
            </p>
          ) : null}
          {lines.others.map((line) => (
            <p key={line.chainId} className="text-body-13 text-02" data-testid="chain-price">
              {line.text}
            </p>
          ))}
          <p className="text-body-13 text-02">
            {costSentence({ mode: tool.pricingMode, price: held, range, freeCallsPerDay: freeAllowance })}
          </p>
          {settles.length > 0 ? (
            <p className="text-body-xs text-03">
              {paidOnText(settles, tool.prices, chainName)}{" "}
              {freeAllowance ? "You need funds there once the free calls run out." : "You pay from funds you hold there."}
            </p>
          ) : null}
          <BuyerCosts className="border-t border-01 pt-3" />
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

      <ToolContractSection toolId={tool.id} publicPage />

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
        ) : serving.length === 0 && tool.kind === "PROVIDER" ? (
          <p className="rounded-xl border border-01 bg-01 px-4 py-3.5 text-body-13 text-02" data-testid="maker-serves">
            Served by {tool.handle ? `@${tool.handle}` : "its maker"} only: it is one maker&apos;s own API, so there is no backup provider.
            {tool.handle ? (
              <>
                {" "}
                <Link href={`/toolsets/handle?handle=${encodeURIComponent(tool.handle)}`} className="inline-flex min-h-10 items-center text-primary-600 hover:underline">
                  See @{tool.handle}
                </Link>
              </>
            ) : null}
          </p>
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
              const notRouted = notTakingPaidCalls(held, listing?.price);
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
                          {listing ? listingOfferText(listing) : ""}
                          {notRouted ? " · not taking paid calls right now" : ""}
                        </span>
                      </div>
                      <Fact label={<ObservedFailuresLabel />}>
                        {failRateLabel(provider.quality, listing?.promisedFailureRate, "this tool")}
                      </Fact>
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
              held,
              serving.map((p) => ({ name: p.name, price: listingOf(p.providerId)?.price, quality: p.quality })),
              chainName,
              { chainsListed: chainPrices.length > 1 },
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
            {freeAllowance && normalisedMode(tool.pricingMode) === "FREE"
              ? `Sign up, create an agent key, and every call is free, up to ${freeAllowance} a day for each agent — no deposit needed.`
              : freeAllowance
              ? `Sign up, create an agent key, and the first ${freeAllowance} calls a day are free for each agent — no deposit needed.`
              : "Sign up, create an agent key and add funds. You pay only for results that pass."}
          </p>
        </div>
        {/* "Use this tool": Connect with only this tool chosen; signed out, sign-in comes back there. */}
        <StartFreeCta
          next={mcpName ? routes.connectTools([mcpName]) : routes.exploreTool(tool.id)}
          label={mcpName ? "Use this tool" : "Start free"}
          signedInLabel={mcpName ? "Use this tool" : "Open app"}
          className="tablet:items-end"
        />
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
