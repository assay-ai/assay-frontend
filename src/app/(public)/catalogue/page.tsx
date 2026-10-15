"use client";

import { ArrowRight, ChevronRight, Store } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FailsOftenChip, FreeTierBadge, UnavailableTag, VerifiedMark } from "@/components/explorer/explorer-bits";
import { NotChargedProof } from "@/components/explorer/not-charged-proof";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
  failRateLabel,
  failsOften,
  formatCallPrice,
  priceRange,
  freeTierLabel,
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
import { useChainName } from "@/hooks/useChainName";
import { ApiError } from "@/libs/ApiClient";
import { loginHref } from "@/libs/login-redirect";
import { routes } from "@/libs/routes";
import type { PublicProvider, PublicTool } from "@/services/public-explorer.service";

/**
 * The public Explorer — route `/catalogue`, no sign-in.
 *
 * What a newcomer needs, in order: the promise and its live proof (what our
 * checks refused to charge, across every buyer), then every tool with its
 * price, free tier and who serves it; each row opens the tool's page. Data is
 * the platform's aggregate only (`GET /public/*`).
 */

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

function ToolRow({ tool, freeAllowance }: { tool: PublicTool; freeAllowance: number | null }) {
  const free = freeTierLabel(tool.pricingMode, freeAllowance);
  const range = priceRange(tool.price, [tool.fromPrice]);
  return (
    <li>
      <Link
        href={routes.publicTool(tool.id)}
        className="group flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
            <FreeTierBadge label={free} />
            {tool.routable ? null : <UnavailableTag />}
          </div>
          {tool.description ? <p className="line-clamp-2 text-body-13 text-02">{tool.description}</p> : null}
          <p className="text-body-xs text-03">
            {tool.providerCount > 0 ? `Served by ${plural(tool.providerCount, "provider")}` : "Nobody serves it yet"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="font-mono text-mono-13 font-semibold text-01">
            {range?.differs ? <span className="font-sans text-body-xs font-normal text-03">from </span> : null}
            {range ? formatCallPrice(range.from) : "—"}
          </span>
          <span className="hidden text-body-xs text-03 tablet:block">
            {range?.differs
              ? `held at most ${formatCallPrice(range.held)}, paid only if it passes`
              : tool.price
                ? "per call, only if it passes"
                : ""}
          </span>
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
  const [view, setView] = React.useState<"tools" | "providers">("tools");
  const [query, setQuery] = React.useState("");
  const tools = usePublicTools();
  const providers = usePublicProviders();
  const features = usePublicFeatures();
  const chainName = useChainName();
  const needle = query.trim().toLowerCase();

  const toolRows = React.useMemo(() => {
    const rows = [...(tools.data?.tools ?? [])].sort(
      (a, b) => Number(b.routable) - Number(a.routable) || b.providerCount - a.providerCount || a.name.localeCompare(b.name),
    );
    return needle ? rows.filter((t) => matches(needle, t.name, t.description, t.id)) : rows;
  }, [tools.data, needle]);

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
      <header className="flex flex-col gap-3">
        <h1 className="text-heading-lg text-01 tablet:text-display-md">Tools your agent can pay for — only when they work</h1>
        <p className="max-w-[720px] text-body-md text-02">
          Every tool here is served by providers who put up a <Term k="stake">stake</Term>. Each result is checked
          before money moves; if it fails, nobody is charged.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <Button asChild>
            <Link href={loginHref({ next: "/" })}>
              Start free
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          {features.demo ? (
            <Button asChild variant="secondary">
              <Link href="/demo">Watch it refuse to charge</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <NotChargedProof />

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
            {active.isSuccess ? (
              <span className="text-body-xs text-03">
                {needle ? `${visible} of ${total}` : total}
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
            title={`Nothing matches “${query.trim()}”`}
            description={view === "tools" ? "Search looks at a tool's name and description." : "Search looks at a provider's name."}
            action={{ label: "Clear the search", onClick: () => setQuery("") }}
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
