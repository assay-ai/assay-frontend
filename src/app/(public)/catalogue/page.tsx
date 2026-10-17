"use client";

import { ChevronRight, Store } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { FailsOftenChip, OfferPrice, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { NotChargedProof, NotChargedSummary } from "@/components/explorer/not-charged-proof";
import { StartFreeCta } from "@/components/explorer/start-free";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { ConnectPanel } from "@/components/toolsets/connect-panel";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
  explorerHref,
  failRateLabel,
  failsOften,
  hasFreeCalls,
  readExplorerState,
  formatCallPrice,
  offerLine,
  offerSubLine,
  priceRange,
  plural,
  smallestFreeAllowance,
  stakeSummary,
} from "@/features/explorer/explorer-text";
import {
  publicErrorText,
  usePublicFeatures,
  usePublicProviderDetails,
  usePublicProviders,
  usePublicTools,
} from "@/features/explorer/use-public-explorer";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { useChainName } from "@/hooks/useChainName";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import type { PublicProvider, PublicTool } from "@/services/public-explorer.service";

/**
 * The public Explorer — route `/catalogue`, no sign-in.
 *
 * What a newcomer needs, in order: the promise with a one-line summary of
 * its live proof, then every tool with its price, free tier and who serves it
 * (each row opens the tool's page), then the full proof (what our checks
 * refused to charge, across every buyer). The tools come before the long
 * proof so a phone visitor sees them without scrolling past it. Data is the
 * platform's aggregate only (`GET /public/*`).
 */

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

function ToolRow({ tool, freeAllowance }: { tool: PublicTool; freeAllowance: number | null }) {
  // "from" only over paid listings: gated on `paidBindings` when the API sends it; `priceRange` ignores free ones.
  const range = priceRange(tool.price, (tool.paidBindings ?? 2) > 1 ? [tool.fromPrice] : []);
  const offer = offerLine({ mode: tool.pricingMode, range, freeCallsPerDay: freeAllowance });
  const sub = offerSubLine(tool.pricingMode, range);
  return (
    <li>
      <Link
        href={routes.publicTool(tool.id)}
        className="group flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
            {tool.routable ? null : <UnavailableTag />}
          </div>
          {tool.description ? <p className="line-clamp-2 text-body-13 text-02">{tool.description}</p> : null}
          {/* Phones: the price line sits under the name, full width. */}
          <OfferPrice offer={offer} className="tablet:hidden" />
          {/* Phones too: when providers charge different prices, the most a call is held for is money, not decoration. */}
          {range?.differs && sub ? <p className="text-body-xs text-03 tablet:hidden">{sub}</p> : null}
          <p className="text-body-xs text-03">
            {tool.providerCount > 0 ? `Served by ${plural(tool.providerCount, "provider")}` : "Nobody serves it yet"}
          </p>
        </div>
        <div className="hidden w-[220px] shrink-0 flex-col items-end gap-0.5 text-right tablet:flex">
          <OfferPrice offer={offer} />
          {sub ? <span className="text-body-xs text-03">{sub}</span> : null}
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03 group-hover:text-02" />
      </Link>
    </li>
  );
}

function ProviderRow({ provider, chainName }: { provider: PublicProvider; chainName: (id: string) => string }) {
  return (
    <li>
      <Link
        href={routes.publicProvider(provider.providerId)}
        className="group flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-sm text-01">{provider.name}</span>
            <VerifiedMark verified={provider.verified} />
            {failsOften(provider.quality) ? <FailsOftenChip /> : null}
          </div>
          <p className="text-body-xs text-03">
            {plural(provider.toolIds.length, "tool")} · {failRateLabel(provider.quality)}
          </p>
          <p className="text-body-xs text-03">
            <Term k="stake" inline>Stake</Term>: {stakeSummary(provider.stake, chainName)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="font-mono text-mono-13 text-01">
            {provider.fromPrice ? `from ${formatCallPrice(provider.fromPrice)}` : "—"}
          </span>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03 group-hover:text-02" />
      </Link>
    </li>
  );
}

export default function CataloguePage() {
  // View, search and the free filter live in the URL, so Back from a tool
  // page lands on the same list. Local state keeps typing instant; the URL
  // follows with `replace` (no history entry per keystroke).
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = React.useMemo(() => readExplorerState(searchParams), [searchParams]);
  // The MCP URL this page stands for: a browser opening `/` (or `/c/{category}`) on the MCP host lands here.
  const [serverUrl] = React.useState(() => {
    const category = searchParams.get("category");
    const host = mcpHost();
    const base = category && /^[a-z][a-z0-9-]{1,63}$/.test(category) ? `${host}/c/${category}` : `${host}/`;
    return searchParams.get("free") === "1" ? `${base}?free=1` : base;
  });
  const [view, setView] = React.useState<"tools" | "providers">(initial.view);
  const [query, setQuery] = React.useState(initial.q);
  const [freeOnly, setFreeOnly] = React.useState(initial.free);
  React.useEffect(() => {
    const next = explorerHref({ view, q: query, free: freeOnly });
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current) router.replace(next, { scroll: false });
  }, [view, query, freeOnly, router]);
  const tools = usePublicTools();
  const providers = usePublicProviders();
  const features = usePublicFeatures();
  const chainName = useChainName();
  const needle = query.trim().toLowerCase();

  const toolRows = React.useMemo(() => {
    const rows = [...(tools.data?.tools ?? [])].sort(
      (a, b) => Number(b.routable) - Number(a.routable) || b.providerCount - a.providerCount || a.name.localeCompare(b.name),
    );
    const free = freeOnly ? rows.filter((t) => hasFreeCalls(t.pricingMode)) : rows;
    return needle ? free.filter((t) => matches(needle, t.name, t.description, t.id)) : free;
  }, [tools.data, needle, freeOnly]);

  const providerRows = React.useMemo(() => {
    const rows = [...(providers.data?.providers ?? [])].sort((a, b) => b.toolIds.length - a.toolIds.length);
    return needle ? rows.filter((p) => matches(needle, p.name, p.providerId)) : rows;
  }, [providers.data, needle]);

  // Each listing's free allowance lives on the provider detail; there are few providers and they are cached.
  const details = usePublicProviderDetails((providers.data?.providers ?? []).map((p) => p.providerId));
  const freeAllowanceOf = (toolId: string) =>
    smallestFreeAllowance(
      details.map((d) => d.data?.tools.find((t) => t.toolId === toolId)?.freeCallsPerAgentPerDay),
    );

  const active = view === "tools" ? tools : providers;
  const total = view === "tools" ? (tools.data?.tools.length ?? 0) : (providers.data?.providers.length ?? 0);
  const visible = view === "tools" ? toolRows.length : providerRows.length;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      <ConnectPanel
        url={serverUrl}
        title={serverUrl.includes("/c/") ? "This is an MCP server URL for one topic. Add it to your client." : "This is an MCP server URL: every tool below, as one server. Add it to your client."}
      />
      <header className="flex flex-col gap-3">
        <h1 className="text-heading-lg text-01 tablet:text-display-md">Tools your agent can pay for — only when they work</h1>
        <p className="max-w-[720px] text-body-md text-02">
          Every tool here is served by providers who put up a <Term k="stake">stake</Term>. Each result is checked
          before money moves; if it fails, nobody is charged.
        </p>
        <div className="flex flex-wrap items-start gap-2.5 pt-1">
          <StartFreeCta next="/" />
          {features.demo ? (
            <Button asChild variant="secondary">
              <Link href="/demo">Watch it refuse to charge</Link>
            </Button>
          ) : null}
        </div>
        <NotChargedSummary />
      </header>

      <section aria-labelledby="list-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex items-center gap-3">
            <h2 id="list-title" className="sr-only">
              {view === "tools" ? "Tools" : "Providers"}
            </h2>
            <Segmented
              value={view}
              onValueChange={(value) => setView(value as "tools" | "providers")}
              aria-label="Show"
              className="inline-flex rounded-md bg-03 p-0.5"
            >
              <SegmentedItem value="tools">Tools</SegmentedItem>
              <SegmentedItem value="providers">Providers</SegmentedItem>
            </Segmented>
            {view === "tools" ? (
              <button
                type="button"
                aria-pressed={freeOnly}
                onClick={() => setFreeOnly((on) => !on)}
                className={
                  freeOnly
                    ? "rounded-full border border-primary-500 bg-primary-10 px-2.5 py-1 text-label-xs text-primary-700"
                    : "rounded-full border border-02 bg-01 px-2.5 py-1 text-label-xs text-02 hover:text-01"
                }
              >
                Free calls
              </button>
            ) : null}
            {active.isSuccess ? (
              <span className="text-body-xs text-03">
                {needle || (freeOnly && view === "tools") ? `${visible} of ${total}` : total}
              </span>
            ) : null}
          </div>
          <Search
            wrapperClassName="w-full tablet:w-[300px]"
            shortcut={null}
            placeholder={view === "tools" ? "Search tools by name or what they do" : "Search providers"}
            aria-label={view === "tools" ? "Search tools" : "Search providers"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {active.isPending ? (
          <div className="rounded-xl border border-01 bg-01 px-4">
            <PageState kind="loading" rows={5} label={`Loading ${view}`} />
          </div>
        ) : active.isError ? (
          <PageState
            kind="error"
            title={`The ${view} could not be loaded`}
            description={publicErrorText(active.error, `the ${view}`)}
            onRetry={() => void active.refetch()}
            code={errorCode(active.error)}
            details={active.error instanceof Error ? active.error.message : null}
          />
        ) : total === 0 ? (
          <PageState
            kind="empty"
            icon={<Store aria-hidden="true" width={22} height={22} />}
            title="No tools are listed yet"
            description="The platform is just opening. If you run an API that agents would pay for, you can be the first to list it."
            action={{ label: "List your API", href: "/why-list-here" }}
          />
        ) : visible === 0 ? (
          <PageState
            kind="empty"
            title={needle ? `Nothing matches “${query.trim()}”` : "No tool has free calls right now"}
            description={
              view === "tools"
                ? `Search looks at a tool's name and description${freeOnly ? ", among tools with free calls" : ""}.`
                : "Search looks at a provider's name."
            }
            action={{
              label: freeOnly && view === "tools" ? "Show all tools" : "Clear the search",
              onClick: () => {
                setQuery("");
                setFreeOnly(false);
              },
            }}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
            {view === "tools"
              ? toolRows.map((tool) => <ToolRow key={tool.id} tool={tool} freeAllowance={freeAllowanceOf(tool.id)} />)
              : providerRows.map((provider) => (
                  <ProviderRow key={provider.providerId} provider={provider} chainName={chainName} />
                ))}
          </ul>
        )}
      </section>

      <NotChargedProof />

      <section className="flex flex-col gap-3 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-6">
        <div className="flex flex-col gap-1">
          <p className="text-label-md text-01">Have an API agents would pay for?</p>
          <p className="text-body-13 text-02">List it, set your price, and get paid per call that passes.</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/why-list-here">See what you would earn</Link>
        </Button>
      </section>
    </div>
  );
}
