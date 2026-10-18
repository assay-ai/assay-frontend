"use client";

import { ChevronRight, ShieldAlert, Store } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { ToolVersionBadges } from "@/components/contracts/version-badges";
import { FailsOftenChip, OfferPrice, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { NotChargedProof, NotChargedSummary } from "@/components/explorer/not-charged-proof";
import { StartFreeCta } from "@/components/explorer/start-free";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { ConnectPanel } from "@/components/toolsets/connect-panel";
import { ToolsetCatalogue } from "@/components/toolsets/public-toolsets";
import { usePublicToolsets } from "@/components/toolsets/use-toolsets";
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
  usePublicNotCharged,
  usePublicProviderDetails,
  usePublicProviders,
  usePublicTools,
} from "@/features/explorer/use-public-explorer";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { buildMcpUrl } from "@/features/connect/mcp-url";
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
 *
 * Nothing here shows an empty promise: the Tool sets tab appears once a tool
 * set is listed, and the proof folds into one line until a paid call has been
 * checked in its window.
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
            {tool.kind === "PROVIDER" ? <MakerChip handle={tool.handle ?? null} /> : null}
            {tool.notReviewed ? <NotReviewedTag /> : null}
            {tool.routable ? null : <UnavailableTag />}
            <ToolVersionBadges name={tool.name} version={tool.version} versions={tool.versions} deprecatedMajors={tool.deprecatedMajors} replacementName={tool.replacementName} replacementVersion={tool.replacementVersion} />
          </div>
          {tool.summary || tool.description ? <p className="line-clamp-2 text-body-13 text-02">{tool.summary || tool.description}</p> : null}
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

/** "One maker's API · @acme": a provider tool, served by its maker only (no backup provider). */
function MakerChip({ handle }: { handle: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-03 px-2 py-0.5 text-label-xs text-02" title="Only its maker serves it, so it has no backup provider.">
      One maker&apos;s API{handle ? ` · @${handle}` : ""}
    </span>
  );
}

function NotReviewedTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700">
      <ShieldAlert aria-hidden="true" className="size-3" />
      Not reviewed
    </span>
  );
}

type KindFilter = "all" | "STANDARD" | "PROVIDER";
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All tools" },
  { id: "STANDARD", label: "Backed by several providers" },
  { id: "PROVIDER", label: "One maker's API" },
];

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

/**
 * The proof of the promise, labelled with its window. Before any paid call
 * was checked in the window it is one line that opens on demand: a panel of
 * zeros next to a provider with thousands of calls reads as a broken promise.
 */
function Proof() {
  const query = usePublicNotCharged();
  const days = query.data?.windowDays ?? 30;
  if (query.isSuccess && query.data.totals.callsChecked === 0) {
    return (
      <details className="rounded-xl border border-01 bg-01 px-4 tablet:px-6" data-testid="proof-collapsed">
        <summary className="min-h-12 cursor-pointer py-3 text-body-13 text-02 hover:text-01">
          <span className="text-label-13 text-01">What our checks refused to charge, last {days} days:</span> no paid
          calls to show yet
        </summary>
        <NotChargedProof className="mb-4 border-0 p-0 tablet:p-0" />
      </details>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="proof">
      <p className="text-label-xs uppercase tracking-wide text-03">Last {days} days · paid calls, across every buyer</p>
      <NotChargedProof />
    </div>
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
  // `/c/{category}` lands here as `?category=`: the list shows that topic, and the panel offers that topic's server.
  const [topic, setTopic] = React.useState<string | null>(() => {
    const category = searchParams.get("category");
    return category && /^[a-z][a-z0-9-]{1,63}$/.test(category) ? category : null;
  });
  const free = searchParams.get("free") === "1";
  const serverUrl = topic ? buildMcpUrl({ kind: "topic", category: topic }, { free }, mcpHost()) : `${mcpHost()}/${free ? "?free=1" : ""}`;
  const [view, setView] = React.useState<"tools" | "providers" | "toolsets">(initial.view);
  const [query, setQuery] = React.useState(initial.q);
  const [freeOnly, setFreeOnly] = React.useState(initial.free);
  const [kind, setKind] = React.useState<KindFilter>("all");
  React.useEffect(() => {
    const next = explorerHref({ view, q: query, free: freeOnly });
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current) router.replace(next, { scroll: false });
  }, [view, query, freeOnly, router]);
  const tools = usePublicTools();
  const providers = usePublicProviders();
  const features = usePublicFeatures();
  // The same first page the Tool sets tab asks for, so opening it is instant.
  const toolsets = usePublicToolsets({ sort: "popular", limit: 60 });
  // An empty tab is a dead end: shown once a tool set is listed, or when a link opened it.
  const showToolsets = (toolsets.data?.total ?? 0) > 0 || view === "toolsets";
  const freeCount = tools.data ? tools.data.tools.filter((t) => hasFreeCalls(t.pricingMode)).length : null;
  const chainName = useChainName();
  const needle = query.trim().toLowerCase();

  const toolRows = React.useMemo(() => {
    const rows = [...(tools.data?.tools ?? [])].sort(
      (a, b) => Number(b.routable) - Number(a.routable) || b.providerCount - a.providerCount || a.name.localeCompare(b.name),
    );
    const inTopic = topic && rows.some((t) => t.category) ? rows.filter((t) => t.category === topic) : rows;
    const free = freeOnly ? inTopic.filter((t) => hasFreeCalls(t.pricingMode)) : inTopic;
    const ofKind = kind === "all" ? free : free.filter((t) => (t.kind ?? "STANDARD") === kind);
    return needle ? ofKind.filter((t) => matches(needle, t.name, t.description, t.id, t.handle)) : ofKind;
  }, [tools.data, needle, freeOnly, topic, kind]);
  const hasProviderTools = Boolean(tools.data?.tools.some((t) => t.kind === "PROVIDER"));
  const topicKnown = Boolean(tools.data?.tools.some((t) => t.category));

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

  const active = view === "providers" ? providers : tools;
  const total = view === "tools" ? (tools.data?.tools.length ?? 0) : (providers.data?.providers.length ?? 0);
  const visible = view === "tools" ? toolRows.length : providerRows.length;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      <ConnectPanel
        publicPage
        url={serverUrl}
        title={
          topic
            ? `One MCP URL for every ${topic} tool: connect your agent to it, or use a tool set URL for a smaller group.`
            : "One MCP URL for everything below: connect your agent to it, or use a tool set URL for a smaller group."
        }
      />
      {topic ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02" data-testid="catalogue-topic">
          <span className="rounded-full bg-primary-10 px-2.5 py-1 text-label-13 text-primary-700">Topic: {topic}</span>
          {topicKnown ? null : <span>Topics are not listed yet, so every tool is shown.</span>}
          <button type="button" className="min-h-10 text-label-13 text-primary-600 hover:underline" onClick={() => setTopic(null)}>
            Show all tools
          </button>
        </p>
      ) : null}
      {view === "toolsets" ? (
        <header className="flex flex-col gap-1">
          <h1 className="text-heading-md text-01">Tool sets</h1>
          <p className="text-body-13 text-02">Ready-made groups of tools, each with its own server URL. Connect one in three clicks, or make your own version.</p>
        </header>
      ) : (
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
      )}

      <section aria-labelledby="list-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex items-center gap-3">
            <h2 id="list-title" className="sr-only">
              {view === "tools" ? "Tools" : view === "toolsets" ? "Tool sets" : "Providers"}
            </h2>
            <Segmented
              value={view}
              onValueChange={(value) => setView(value as "tools" | "providers" | "toolsets")}
              aria-label="Show"
              className="inline-flex rounded-md bg-03 p-0.5"
            >
              <SegmentedItem value="tools">Tools</SegmentedItem>
              {showToolsets ? <SegmentedItem value="toolsets">Tool sets</SegmentedItem> : null}
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
                aria-label={freeCount === null ? "Free calls" : `Free calls: ${plural(freeCount, "tool")}`}
              >
                Free calls{freeCount === null ? null : <span className="ml-1 font-mono">{freeCount}</span>}
              </button>
            ) : null}
            {active.isSuccess && view !== "toolsets" ? (
              <span className="text-body-xs text-03">
                {needle || (view === "tools" && (freeOnly || kind !== "all" || (topic && topicKnown))) ? `${visible} of ${total}` : total}
              </span>
            ) : null}
          </div>
          <Search
            wrapperClassName="w-full tablet:w-[300px]"
            shortcut={null}
            placeholder={view === "tools" ? "Search tools by name or what they do" : view === "toolsets" ? "Search tool sets" : "Search providers"}
            aria-label={view === "tools" ? "Search tools" : view === "toolsets" ? "Search tool sets" : "Search providers"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {view === "tools" && hasProviderTools ? (
          <div role="group" aria-label="Kind of tool" className="flex flex-wrap gap-2" data-testid="kind-filter">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={kind === f.id}
                onClick={() => setKind(f.id)}
                className={
                  kind === f.id
                    ? "min-h-10 rounded-full border border-primary-500 bg-primary-10 px-3 text-label-13 text-primary-700"
                    : "min-h-10 rounded-full border border-02 bg-01 px-3 text-label-13 text-02 hover:text-01"
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}

        {view === "toolsets" ? (
          <ToolsetCatalogue query={query} onClearQuery={() => setQuery("")} />
        ) : active.isPending ? (
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
            title={needle ? `Nothing matches “${query.trim()}”` : freeOnly ? "No tool has free calls right now" : "No tool of this kind yet"}
            description={
              view === "tools"
                ? `Search looks at a tool's name and description${freeOnly ? ", among tools with free calls" : ""}.`
                : "Search looks at a provider's name."
            }
            action={{
              label: (freeOnly || kind !== "all") && view === "tools" ? "Show all tools" : "Clear the search",
              onClick: () => {
                setQuery("");
                setFreeOnly(false);
                setKind("all");
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

      {view === "toolsets" ? null : <Proof />}

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
