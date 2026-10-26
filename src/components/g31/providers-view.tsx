"use client";

import { ChevronRight, Info, LayoutGrid } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { failRateShort, FAILURE_RATE_WINDOW_DAYS, stakeRuleSentence } from "@/features/explorer/explorer-text";
import { chainsText, servingStatus } from "@/features/toolsets/provider-fit";
import { useChainName } from "@/hooks/useChainName";
import { chainName as chainNameOf } from "@/utils/chain";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/components/ui/search";
import { ApiError } from "@/libs/ApiClient";

import { initialsOf, MicroLabel, PageHeader, StatusPill } from "./chrome";
import { ExploreNav } from "./explore-nav";
import { formatPrice, stakeLines, type ChainStake } from "./format";
import { useCatalogue, type ProviderRow } from "./use-catalogue";
import { routes } from "@/libs/routes";
import { useChainTerms } from "@/hooks/useChainTerms";

/**
 * Providers explorer.
 *
 * Every card carries five non-negotiable things: the
 * provider's **name**, a **verified** label, **quality measured on real
 * traffic**, the **stake currently bonded**, and — via the header — a filter
 * that shows only verified providers.
 *
 * **There is no first-party tier.** Assay is a card like any other here,
 * distinguished by nothing except whether the verified label is on it. No
 * card is pinned, ordered first, coloured differently or given a badge the
 * others cannot earn. The design's own launch note says why: the verified
 * label is an identity check, not a gate — it tells you who you are buying
 * from, not whether they are any good. Quality does that.
 *
 * Stake is per chain — a list, never a sum, and an empty list
 * is "we could not read it" rather than "nothing at risk". See
 * `ProviderStake` below for both halves of that.
 *
 * **p95** still cannot be answered by this API — `GET /providers/me/quality`
 * is self-only — and is drawn as absent rather than as zero.
 *
 * Quality is real, and is computed from this organization's own settled
 * calls. It is null — printed "not measured yet" — until at least one call
 * has a verdict that says something about money.
 */

type SortKey = "quality" | "calls" | "price" | "name";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "quality", label: "Failure rate" },
  { value: "calls", label: "Calls" },
  { value: "price", label: "Price" },
  { value: "name", label: "Name" },
];

/**
 * The card's stake stat — **one line per chain, never a sum**.
 *
 * ## Empty, not falsy
 *
 * The absent state is keyed on `length === 0`. It used to be keyed on
 * truthiness, from when the field was a nullable `Money`, and when the wire
 * turned it into an array that test stopped being reachable: every array is
 * truthy, the empty one included. So the "—" was dead code and the live branch
 * handed an array to `formatMoney`, which threw inside decimal.js on
 * `Decimal.pow(undefined)` and took the whole explorer down with it.
 *
 * Empty still means **we could not read it** — an RPC outage, an unproved
 * stake authority — and never "nothing at risk". A chain read as zero is a
 * zero-amount entry and draws as `$0.00`, which is a different and much
 * stronger claim than the dash.
 *
 * ## Why the chain is only named when there are two
 *
 * One enabled chain is today's case and reads exactly as it always has — a
 * bare figure. The moment a provider is collateralised on two, the figures
 * stop being comparable (two CAIP-19 assets, no rate between them) and each
 * has to say which chain it belongs to, or the card shows a number that is
 * true on one chain and false on the other with nothing saying which.
 */
function ProviderStake({ stake, chainName }: { stake: ChainStake[]; chainName: (chainId: string) => string }) {
  const lines = stakeLines(stake);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <MicroLabel className="font-sans">Stake</MicroLabel>
      {lines.length === 0 ? (
        <span
          data-testid="provider-stake"
          data-chains="0"
          title="No chain could be read for this provider. Not the same as nothing staked."
          className="font-mono text-mono-13 font-semibold text-03"
        >
          —
        </span>
      ) : (
        <span
          data-testid="provider-stake"
          data-chains={lines.length}
          className="flex min-w-0 flex-col gap-0.5"
        >
          {lines.map((line) => (
            <span key={line.chainId} className="flex min-w-0 flex-col">
              {line.label ? (
                <span className="truncate text-body-xs text-03">{chainName(line.chainId)}</span>
              ) : null}
              <span className="font-mono text-mono-13 font-semibold text-01">{line.amount}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Whether this provider takes a call from YOUR agents now (B16): "Serves you",
 * "Doesn't take payment on your chain", "Not taking calls now", or "Can't
 * check right now" when the backend could not read it. Computed by the backend
 * from the router's own gates and your agents' chains; nothing shows before
 * it has loaded.
 */
export function ServingChip({ fit }: { fit: { chains?: readonly string[] | null; servesYou?: boolean | null; notServedReason?: "WITHDRAWING" | null } }) {
  const status = servingStatus(fit);
  if (status.kind === "not-loaded") return null;
  return (
    <span data-testid="serving-chip" data-kind={status.kind}>
      <StatusPill label={status.label} tone={status.tone} />
    </span>
  );
}

/**
 * Exported so `providers-view.dom.test.tsx` can render it and assert on the
 * markup that comes out. The Stake stat's regression was a THROW at render,
 * which a test over the presenter alone would have missed the shape of — it
 * has to be the component, and the assertion has to be the DOM.
 */
export function ProviderCard({
  provider,
  callsWindow,
  chainName = (chainId) => chainNameOf(chainId),
}: {
  provider: ProviderRow;
  callsWindow?: string;
  /** Names a chain for the stake lines (`useChainName` on the page): never a raw CAIP-2 id. */
  chainName?: (chainId: string) => string;
}) {
  return (
    <Link
      href={routes.exploreProvider(provider.providerId)}
      data-testid="provider-card"
      data-verified={provider.verified ? "true" : "false"}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-01 bg-01 p-[18px] transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex w-full items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-10 font-mono text-label-sm text-primary-600">
          {initialsOf(provider.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-label-md text-01">{provider.name}</span>
          <span className="flex flex-wrap gap-1.5">
            {provider.verified ? (
              <StatusPill label="VERIFIED" tone="primary" />
            ) : (
              <StatusPill label="NOT VERIFIED" tone="neutral" />
            )}
            <ServingChip fit={provider} />
          </span>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
      </div>

      <p className="text-body-13 text-02">
        {provider.toolIds.length} {provider.toolIds.length === 1 ? "tool" : "tools"} served
        {chainsText(provider, chainName) ? ` · ${chainsText(provider, chainName)}` : ""}
        {provider.yourCalls > 0
          ? ` · you have called them ${provider.yourCalls} ${provider.yourCalls === 1 ? "time" : "times"} (calls to all their tools)${callsWindow ? ` ${callsWindow}` : ""}`
          : ""}
        .
      </p>

      <div className="flex w-full gap-2.5 border-t border-01 pt-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <MicroLabel className="font-sans">Failure rate</MicroLabel>
          {provider.quality == null ? (
            <span className="truncate font-mono text-mono-13 text-03">not measured</span>
          ) : (
            <>
              <span className="font-mono text-mono-13 font-semibold text-01" data-testid="provider-failure-rate">
                {failRateShort(provider)}
              </span>
              <span className="text-body-xs text-03">
                of {provider.measuredCalls.toLocaleString("en-US")} checked calls to all their tools, last{" "}
                {FAILURE_RATE_WINDOW_DAYS} days
              </span>
            </>
          )}
        </div>
        <ProviderStake stake={provider.stake} chainName={chainName} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <MicroLabel className="font-sans">From</MicroLabel>
          <span className="font-mono text-mono-13 font-semibold text-01">
            {formatPrice(provider.fromPrice)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ProvidersView() {
  const { terms: chainTerms } = useChainTerms();
  const { providers, tools, isPending, isError, error, callsWindow } = useCatalogue();
  const chainName = useChainName();
  const [query, setQuery] = React.useState("");
  const [verifiedOnly, setVerifiedOnly] = React.useState(false);
  const [sort, setSort] = React.useState<SortKey>("quality");

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = providers.filter((provider) => {
      if (verifiedOnly && !provider.verified) return false;
      if (!needle) return true;
      return (
        provider.name.toLowerCase().includes(needle) ||
        provider.providerId.toLowerCase().includes(needle)
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "calls") return b.yourCalls - a.yourCalls;
      if (sort === "price") {
        if (!a.fromPrice) return 1;
        if (!b.fromPrice) return -1;
        return Number(a.fromPrice.amount) - Number(b.fromPrice.amount);
      }
      // Quality: an unmeasured provider sorts last rather than as a zero.
      if (a.quality == null && b.quality == null) return 0;
      if (a.quality == null) return 1;
      if (b.quality == null) return -1;
      return b.quality - a.quality;
    });
    return sorted;
  }, [providers, query, sort, verifiedOnly]);

  const verifiedCount = providers.filter((p) => p.verified).length;

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:gap-4 tablet:px-7 tablet:py-[18px]">
      <ExploreNav />

      <PageHeader
        title="Providers"
        subtitle={`${providers.length} providers · ${tools.length} tools · failure rates are measured on real traffic across the platform, not claimed`}
        actions={
          <>
            <Search
              wrapperClassName="w-full tablet:w-[300px]"
              placeholder="Search providers by name or id…"
              aria-label="Search providers by name or id"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex items-center gap-2 rounded-md border border-02 bg-01 px-3 py-[9px]">
              <Checkbox
                data-testid="verified-only"
                label="Verified only"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border border-02 bg-01 px-3 py-[9px]">
              <span className="text-body-13 text-03">Sort</span>
              <select
                aria-label="Sort providers"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="cursor-pointer appearance-none bg-transparent font-mono text-mono-13 font-semibold text-01 outline-none"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-01 px-4 py-3">
        <Info aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
        <p className="text-body-13 text-02" data-testid="providers-stake-rule">
          Anyone can register and list a tool, and a provider stakes before serving paid calls.{" "}
          {stakeRuleSentence(chainTerms.dailyCapPercent)} The verified label is an identity check, not a gate: it tells you who
          you are buying from, not whether their results are good. The failure rate does that.
        </p>
      </div>

      <div className="flex w-full flex-col gap-[18px] tablet:flex-row tablet:items-start">
        <aside className="hidden w-[220px] shrink-0 flex-col gap-[3px] rounded-xl border border-01 bg-01 p-2.5 desktop:flex">
          <div className="px-2.5 pb-1.5 pt-2">
            <MicroLabel>CATEGORIES</MicroLabel>
          </div>
          <div className="flex items-center gap-2.5 rounded-md bg-03 px-2.5 py-[9px]">
            <LayoutGrid aria-hidden="true" className="size-[15px] shrink-0 text-01" />
            <span className="flex-1 text-label-13 text-01">All providers</span>
            <span className="font-mono text-mono-12 text-03">{providers.length}</span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          {isPending ? (
            <p className="font-mono text-mono-13 text-03">Loading the catalogue…</p>
          ) : isError ? (
            <p className="text-body-13 text-danger-600">
              The catalogue could not be read:{" "}
              {error instanceof ApiError ? error.message : "the request failed"}.
            </p>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid width={22} height={22} />}
              title={
                verifiedOnly && providers.length > 0
                  ? "No verified provider matches"
                  : query.trim()
                    ? "No provider matches that search"
                    : "No provider is serving traffic yet"
              }
              description={
                verifiedOnly && providers.length > 0
                  ? `${providers.length} provider${providers.length === 1 ? " is" : "s are"} listed, ${verifiedCount} of them verified. Clear the verified filter to see the rest — an unverified provider is one whose identity we have not checked, not one whose answers are bad.`
                  : query.trim()
                    ? `${providers.length} provider${providers.length === 1 ? " is" : "s are"} listed. Search matches a provider's name and id.`
                    : "This list is the whole platform, not your own traffic — so it is empty only when nobody has listed a tool yet. A provider appears the moment one of their tools goes live."
              }
            />
          ) : (
            <div className="grid w-full grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
              {visible.map((provider) => (
                <ProviderCard
                  key={provider.providerId}
                  provider={provider}
                  callsWindow={callsWindow}
                  chainName={chainName}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
