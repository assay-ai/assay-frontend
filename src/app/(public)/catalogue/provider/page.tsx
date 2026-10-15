"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FailsOftenChip, Fact, FreeTierBadge, VerifiedMark } from "@/components/explorer/explorer-bits";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { failRateLabel, failsOften, formatCallPrice, freeTierLabel, plural, stakeSummary } from "@/features/explorer/explorer-text";
import { publicErrorText, usePublicProvider } from "@/features/explorer/use-public-explorer";
import { useChainName } from "@/hooks/useChainName";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";

/**
 * One provider, public — route `/catalogue/provider?id=`. Their measured
 * failure record, the stake they put up per chain, and the tools they serve.
 */

function ProviderPage() {
  const id = useSearchParam("id");
  const query = usePublicProvider(id);
  const chainName = useChainName();
  // A static export cannot set per-provider metadata; name the provider in the tab.
  useDocumentTitle(query.data ? `${query.data.name} — Assay` : null);

  if (!id || (query.isError && query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400))) {
    return (
      <PageState
        kind="empty"
        title="This provider is not listed"
        description="They may have paused or left the platform."
        action={{ label: "See all tools", href: "/catalogue" }}
      />
    );
  }
  if (query.isPending) return <PageState kind="loading" rows={4} label="Loading the provider" />;
  if (query.isError) {
    return (
      <PageState
        kind="error"
        title="This provider could not be loaded"
        description={publicErrorText(query.error, "this provider")}
        onRetry={() => void query.refetch()}
        code={query.error instanceof ApiError ? query.error.code : null}
      />
    );
  }

  const provider = query.data;
  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-heading-md text-01">{provider.name}</h1>
          <VerifiedMark verified={provider.verified} />
          {failsOften(provider.quality) ? <FailsOftenChip /> : null}
        </div>
        <p className="text-body-13 text-02">Serves {plural(provider.tools.length, "tool")} on Assay.</p>
      </header>

      <section className="grid grid-cols-1 gap-4 rounded-xl border border-01 bg-01 p-4 tablet:grid-cols-2 tablet:p-5">
        <Fact label="Observed failures">{failRateLabel(provider.quality)}</Fact>
        <Fact label="Stake at risk">{stakeSummary(provider.stake, chainName)}</Fact>
        <p className="text-body-xs text-03 tablet:col-span-2">
          Failures are measured by Assay on real calls, not reported by the provider. If they fail more often than they
          promised, they pay a <Term k="penalty">penalty</Term> from their <Term k="stake">stake</Term>, shared with the buyers affected.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-label-md text-01">Tools they serve</h2>
        {provider.tools.length === 0 ? (
          <PageState kind="empty" title="No tools listed right now" action={{ label: "See all tools", href: "/catalogue" }} />
        ) : (
          <ul className="flex flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
            {provider.tools.map((tool) => (
              <li key={tool.toolId}>
                <Link
                  href={routes.publicTool(tool.toolId)}
                  className="group flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
                    <FreeTierBadge label={freeTierLabel(tool.pricingMode, tool.freeCallsPerAgentPerDay)} />
                  </div>
                  <span className="shrink-0 font-mono text-mono-13 text-01">{formatCallPrice(tool.price)}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03 group-hover:text-02" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function PublicProviderPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      <Link href="/catalogue" className="inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        All tools
      </Link>
      <React.Suspense fallback={<PageState kind="loading" rows={4} label="Loading the provider" />}>
        <ProviderPage />
      </React.Suspense>
    </div>
  );
}
