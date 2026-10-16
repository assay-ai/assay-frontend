"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Gift, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { NotChargedProof } from "@/components/explorer/not-charged-proof";
import { FailsOftenChip, Fact, ObservedFailuresLabel, OfferPrice, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { useFreeOnlyChain } from "@/components/buyer-money/use-buyer-money";
import { ToolAccessControl, useSpendPolicy } from "@/components/explorer/tool-access-control";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import {
  checkSentences,
  costSentence,
  failRateLabel,
  failsOften,
  formatCallPrice,
  notTakingPaidCalls,
  offerLine,
  offerSubLine,
  plural,
  priceRange,
  routingNotes,
  smallestFreeAllowance,
  stakeSummary,
} from "@/features/explorer/explorer-text";
import { accessSummary, toolAccess } from "@/features/explorer/tool-access";
import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { useChainName } from "@/hooks/useChainName";
import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import { ApiError } from "@/libs/ApiClient";
import { freeOnlyExploreText } from "@/libs/chains/paid-rails";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getBalances } from "@/services";
import { getCatalogueProvider, type CatalogueProviderDetail } from "@/services/catalogue.service";
import { chainDisplayName } from "@/services/chains.service";
import { cn } from "@/utils";
import { formatMoney, notCharged, toDecimal } from "@/utils/money";

import { ExploreNav } from "./explore-nav";
import { PageHeader } from "./chrome";
import { settlementReach } from "./settlement-reach";
import { useCatalogue, type ProviderRow, type ToolRow } from "./use-catalogue";

/**
 * Explore (`/explore`) — "find a tool, see what it costs and whether to trust
 * it, and let my agents use it or block it", on one page.
 *
 * One searchable list of every tool on the platform. A row opens in place
 * (and `?tool=<id>` opens it from a link) to show what it does, the price and
 * when you pay, what is checked, the providers with their measured failures
 * and stake, your own calls, and Allow / Block — the same allowlist Budgets
 * writes. A tool that settles on a chain you hold nothing on says which chain
 * and offers Add funds.
 */

/**
 * A tool the buyer's chains cannot reach is marked, never hidden, naming the
 * chain(s) and linking to fund one. Nothing when either side is unknown.
 */
export function SettlesElsewhere({
  tool,
  buyerChains,
  chains,
}: {
  tool: ToolRow;
  buyerChains: readonly string[];
  chains: readonly Chain[];
}) {
  const reach = settlementReach(tool.settlementChains, buyerChains);
  if (reach.kind !== "unreachable") return null;
  const names = reach.toolChains.map((chain) => chainDisplayName(chains, chain));
  return (
    <div data-testid="settles-elsewhere" className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 p-3 tablet:flex-row tablet:items-center tablet:justify-between">
      <p className="flex items-start gap-2 text-body-13 text-warning-700">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          Settles on {names.join(", ")} — you have no funds there. Calls to it are refused until you add some.
        </span>
      </p>
      <Button size="sm" variant="secondary" asChild>
        <Link href="/funding?action=deposit">Add funds on {names[0]}</Link>
      </Button>
    </div>
  );
}

function ToolDetail({
  tool,
  providers,
  details,
  freeAllowance,
  buyerChains,
  chains,
  allToolIds,
  callsWindow,
}: {
  tool: ToolRow;
  providers: ProviderRow[];
  details: Map<string, CatalogueProviderDetail>;
  freeAllowance: number | null;
  buyerChains: readonly string[];
  chains: readonly Chain[];
  allToolIds: readonly string[];
  callsWindow: string;
}) {
  const chainName = useChainName();
  const uncharged = tool.listed && tool.charged ? notCharged(tool.listed, tool.charged) : null;
  // Same as the public tool page: "from" only over more than one listing that can be charged.
  const range = priceRange(
    tool.price,
    (tool.paidBindings ?? 2) > 1
      ? [
          tool.fromPrice,
          ...providers.map((p) => details.get(p.providerId)?.tools.find((t) => t.toolId === tool.toolId)?.price),
        ]
      : [],
  );
  // Free first, then paid: a FREEMIUM tool says its free calls before any range.
  const costLine = costSentence({ mode: tool.pricingMode, price: tool.price, range, freeCallsPerDay: freeAllowance });

  return (
    <div className="flex flex-col gap-4 border-t border-01 bg-02 px-4 py-4 tablet:px-5">
      {tool.description ? <p className="text-body-13 text-02">{tool.description}</p> : null}

      <SettlesElsewhere tool={tool} buyerChains={buyerChains} chains={chains} />

      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-label-13 text-01">What a call costs</h3>
          <p className="text-body-13 text-02">
            {costLine}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-label-13 text-01">What is checked</h3>
          <ul className="flex flex-col gap-1">
            {checkSentences(tool.tier).map((line) => (
              <li key={line} className="flex items-start gap-1.5 text-body-13 text-02">
                <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success-500" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label-13 text-01">Who serves it</h3>
        {providers.length === 0 ? (
          <p className="text-body-13 text-02">Nobody serves this tool right now, so calls to it are refused.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-01 overflow-hidden rounded-lg border border-01 bg-01">
            {providers.map((provider) => {
              const listing = details.get(provider.providerId)?.tools.find((t) => t.toolId === tool.toolId);
              return (
                <li key={provider.providerId}>
                  <Link
                    href={routes.exploreProvider(provider.providerId)}
                    className="flex w-full items-start gap-3 px-3.5 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 tablet:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)] tablet:gap-4">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-label-sm text-01">{provider.name}</span>
                          <VerifiedMark verified={provider.verified} />
                          {failsOften(provider) ? <FailsOftenChip /> : null}
                        </span>
                        {listing ? (
                          <span className="text-body-xs text-03">
                            {formatCallPrice(listing.price)} per call
                            {notTakingPaidCalls(tool.price, listing.price) ? " · not taking paid calls right now" : ""}
                          </span>
                        ) : null}
                      </div>
                      <Fact label={<ObservedFailuresLabel />}>
                        {failRateLabel(provider.quality == null ? null : provider)}
                      </Fact>
                      <Fact label="Stake at risk">{stakeSummary(provider.stake, chainName)}</Fact>
                    </div>
                    <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-03" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {routingNotes(
          tool.price,
          providers.map((p) => ({
            name: p.name,
            price: details.get(p.providerId)?.tools.find((t) => t.toolId === tool.toolId)?.price,
            quality: p.quality == null ? null : p,
          })),
          chainName,
        ).map((note) => (
          <p key={note} className="text-body-13 text-02" data-testid="routing-note">
            {note}
          </p>
        ))}
      </div>

      {/* The same platform-wide record the public tool page shows, so a signed-in buyer sees the same facts. */}
      <NotChargedProof toolId={tool.toolId} limit={5} />

      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <p className="text-body-13 text-02">
          {tool.yourCalls > 0 ? (
            <>
              Your agents made {plural(tool.yourCalls, "call")} {callsWindow}: {formatMoney(tool.charged, { decimals: 4 })} charged
              {uncharged && toDecimal(uncharged).gt(0) ? `, ${formatMoney(uncharged, { decimals: 4 })} not charged` : ""}.{" "}
              <Link href={routes.calls({ tool: tool.toolId })} className="text-primary-600 hover:underline">
                See the calls
              </Link>
            </>
          ) : (
            `Your agents have not called it ${callsWindow}.`
          )}
        </p>
        <ToolAccessControl toolId={tool.toolId} toolName={tool.name} allToolIds={allToolIds} />
      </div>
    </div>
  );
}

function ToolsList() {
  const { tools, providers, isPending, isError, error, callsWindow } = useCatalogue();
  const params = useSearchParams();
  const router = useRouter();
  const openId = params.get("tool");
  const [query, setQuery] = React.useState("");
  const policy = useSpendPolicy();
  const { chains } = useChains();
  const openRef = React.useRef<HTMLLIElement | null>(null);

  const balancesQuery = useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    retry: 0,
    networkMode: "always" as const,
  });
  const buyerChains = React.useMemo(
    () => chainBalances(balancesQuery.data?.balances).map((row) => row.chainId),
    [balancesQuery.data],
  );

  // Provider details carry each listing's free allowance; there are few providers and they are cached.
  const detailQueries = useQueries({
    queries: providers.map((p) => ({
      queryKey: ["catalogue", "provider", p.providerId],
      queryFn: () => getCatalogueProvider(p.providerId),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const details = React.useMemo(() => {
    const map = new Map<string, CatalogueProviderDetail>();
    for (const q of detailQueries) if (q.data) map.set(q.data.providerId, q.data);
    return map;
  }, [detailQueries]);

  const freeAllowanceOf = React.useCallback(
    (toolId: string) =>
      smallestFreeAllowance(
        [...details.values()].map((d) => d.tools.find((t) => t.toolId === toolId)?.freeCallsPerAgentPerDay),
      ),
    [details],
  );

  const allToolIds = React.useMemo(() => tools.map((t) => t.toolId), [tools]);
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...tools].sort(
      (a, b) => Number(b.routable) - Number(a.routable) || b.yourCalls - a.yourCalls || a.name.localeCompare(b.name),
    );
    if (!needle) return sorted;
    return sorted.filter(
      (t) => t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle) || t.toolId === needle,
    );
  }, [tools, query]);

  React.useEffect(() => {
    if (openId && openRef.current) openRef.current.scrollIntoView({ block: "nearest" });
  }, [openId, isPending]);

  const toggle = (toolId: string) =>
    router.replace(openId === toolId ? "/explore" : routes.exploreTool(toolId), { scroll: false });

  return (
    <>
      <div className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <Search
          wrapperClassName="w-full tablet:w-[340px]"
          shortcut={null}
          placeholder="Search tools by name or what they do"
          aria-label="Search tools"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {policy.data ? (
          <p className="text-body-13 text-03">
            {accessSummary(policy.data.allowedTools, tools.length)}{" "}
            <Link href="/limits" className="text-primary-600 hover:underline">
              Spending limits
            </Link>
          </p>
        ) : null}
      </div>

      {isPending ? (
        <PageState kind="loading" rows={6} label="Loading tools" />
      ) : isError ? (
        <PageState
          kind="error"
          title="Tools could not be loaded"
          description={plainError(error instanceof ApiError ? error.code : "ERR_NETWORK")}
          code={error instanceof ApiError ? error.code : null}
          onRetry={() => window.location.reload()}
        />
      ) : tools.length === 0 ? (
        <PageState
          kind="empty"
          title="No tools are listed yet"
          description="Tools appear here the moment a provider lists one. Nothing to set up on your side."
        />
      ) : visible.length === 0 ? (
        <PageState
          kind="empty"
          title={`Nothing matches “${query.trim()}”`}
          description="Search looks at a tool's name and what it does."
          action={{ label: "Clear the search", onClick: () => setQuery("") }}
        />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01">
          {visible.map((tool) => {
            const open = openId === tool.toolId;
            const blocked = policy.data ? toolAccess(policy.data.allowedTools, tool.toolId) === "blocked" : false;
            const serving = providers.filter((p) => p.toolIds.includes(tool.toolId));
            // The backend's own figure first (its total over every free-capable listing, capped).
            const freeAllowance = tool.freeCallsPerDay ?? freeAllowanceOf(tool.toolId);
            // "from" only over listings that can be charged: one paid listing is one price.
            const range = priceRange(tool.price, (tool.paidBindings ?? 2) > 1 ? [tool.fromPrice] : []);
            // One price line, free first — the same line the public Explorer shows.
            const offer = offerLine({ mode: tool.pricingMode, range, freeCallsPerDay: freeAllowance });
            const sub = offerSubLine(tool.pricingMode, range);
            return (
              <li key={tool.toolId} ref={open ? openRef : undefined} className="border-b border-01 last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(tool.toolId)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
                      {tool.routable ? null : <UnavailableTag />}
                      {blocked ? (
                        <span className="rounded-full bg-danger-10 px-2 py-0.5 text-label-xs text-danger-700">Blocked</span>
                      ) : null}
                    </span>
                    <span className={cn("text-body-xs text-03", open ? "" : "line-clamp-1")}>
                      {serving.length > 0 ? `Served by ${plural(serving.length, "provider")}` : "Nobody serves it yet"}
                      {tool.yourCalls > 0 ? ` · ${plural(tool.yourCalls, "call")} from your agents ${callsWindow}` : ""}
                    </span>
                    {/* Phones: the price line sits under the name, full width. */}
                    <OfferPrice offer={offer} className="tablet:hidden" />
                    {/* Phones too: the most a call is held for, when providers charge different prices. */}
                    {range?.differs && sub ? <span className="text-body-xs text-03 tablet:hidden">{sub}</span> : null}
                  </div>
                  <div className="hidden w-[220px] shrink-0 flex-col items-end gap-0.5 text-right tablet:flex">
                    <OfferPrice offer={offer} />
                    {sub ? <span className="text-body-xs text-03">{sub}</span> : null}
                  </div>
                  {open ? (
                    <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-03" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                  )}
                </button>
                {open ? (
                  <ToolDetail
                    tool={tool}
                    providers={serving}
                    details={details}
                    freeAllowance={freeAllowance}
                    buyerChains={buyerChains}
                    chains={chains}
                    allToolIds={allToolIds}
                    callsWindow={callsWindow}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** A free-calls-only chain (Solana today; the demo's `?rails=free-only`): the prices here are not for these agents. */
function FreeOnlyNote() {
  const { freeOnly, chainName } = useFreeOnlyChain();
  if (!freeOnly) return null;
  return (
    <p
      data-testid="explore-free-only"
      className="flex items-start gap-2 rounded-lg border border-teal-20 bg-teal-10 px-3.5 py-2.5 text-body-13 text-teal-700"
    >
      <Gift aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{freeOnlyExploreText(chainName ?? "this chain")}</span>
    </p>
  );
}

export function ToolsView() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:px-7 tablet:py-5">
      <ExploreNav />
      <PageHeader title="Tools" />
      <p className="-mt-2 text-body-13 text-03">
        Every tool your agents can call through Assay. You pay only for results that pass the check; allow or block
        each one for your agents. <Term k="free-tier">Free tier</Term> calls need no funds, and come first: a tool with a
        free tier serves your agent&apos;s free calls each day before any call is charged.
      </p>
      <FreeOnlyNote />
      <React.Suspense fallback={<PageState kind="loading" rows={6} label="Loading tools" />}>
        <ToolsList />
      </React.Suspense>
    </div>
  );
}
