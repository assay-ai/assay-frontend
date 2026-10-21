"use client";

import { BadgeCheck, ChevronRight, Copy as CopyIcon, Flag, Layers, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useSignedIn } from "@/components/explorer/start-free";
import { PageHeader } from "@/components/g31/chrome";
import { ExploreNav } from "@/components/g31/explore-nav";
import { PageState, Skeleton } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { usePublicTools } from "@/features/explorer/use-public-explorer";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { buildMcpUrl, toolDisplay } from "@/features/connect/mcp-url";
import { contractChipParts, currentMajorOf, entryContractWarning } from "@/features/contracts/entry-contract";
import type { ToolVersionBrief } from "@/interfaces/contracts";
import { humanToolName, ruleDetails } from "@/features/toolsets/sharing";
import { lockLabel, MAKE_MY_OWN_HINT, MAKE_MY_OWN_LABEL, PROVIDER_MODE_LABELS } from "@/features/toolsets/labels";
import { activeUsersText, badgeLabel, priceOfTool, priceRangeText, statRows, trustFacts, type CatalogueToolsetFilters } from "@/features/toolsets/public";
import { ApiError } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { loginHref } from "@/libs/login-redirect";
import { formatDate } from "@/libs/utc-time";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import type { PublicHandleTool, PublicToolsetCard, PublicToolsetPage } from "@/services/public-toolsets.service";
import type { PublicTool } from "@/services/public-explorer.service";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { ConnectPanel } from "./connect-panel";
import { Chip, CopyButton, CopyLine, CopyToolsetSheet, DiffView, FigureGrid, ReportSheet } from "./toolset-bits";
import {
  usePublicCategories,
  usePublicHandle,
  usePublicToolset,
  usePublicToolsets,
  usePublicToolsetVersion,
  usePublicToolsetVersions,
  useToolsetByToken,
} from "./use-toolsets";

/**
 * Public tool sets (design spec §7.10 "Catalogue"): the catalogue's Tool sets
 * tab, a tool set's page (`/toolsets/view?handle=&slug=[&v=]`, or `#token=`
 * for a link-only one) and a public name's page (`/toolsets/handle?handle=`).
 *
 * A tool set's page reads, in order: what it is, the trust facts (price range,
 * "No backup provider", "Not reviewed", "Routes to the publisher's own
 * provider"), Connect (signed out: "Start free", which comes back to the
 * open sheet), the tools with their rules, the weekly figures, the versions,
 * then "Make my own version" and Report.
 */

const PUBLISHERS: { id: CatalogueToolsetFilters["publisher"]; label: string }[] = [
  { id: null, label: "All" },
  { id: "official", label: "Official" },
  { id: "provider", label: "Provider" },
  { id: "community", label: "Community" },
];

export function toolsetPageHref(card: Pick<PublicToolsetCard, "handle" | "slug">): string {
  return `/toolsets/view?handle=${encodeURIComponent(card.handle)}&slug=${encodeURIComponent(card.slug)}`;
}

function badgeTone(badge: string): "primary" | "success" | "neutral" {
  return badge === "OFFICIAL" ? "primary" : badge === "PROVIDER" ? "success" : "neutral";
}

/** One card: name, @handle, badge, tool count, active users, price range, and the chips that matter. */
export function ToolsetCard({ card, catalogue }: { card: PublicToolsetCard; catalogue: readonly PublicTool[] | null }) {
  const facts = trustFacts(card, catalogue);
  return (
    <li>
      <Link
        href={toolsetPageHref(card)}
        aria-label={`${card.name}, @${card.handle}/${card.slug}, ${badgeLabel(card.badge)}, ${card.toolCount} tool${card.toolCount === 1 ? "" : "s"}, ${activeUsersText(card.activeUsers)}`}
        className="group flex h-full min-w-0 flex-col gap-2 rounded-xl border border-01 bg-01 p-4 hover:border-02 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        data-testid="toolset-card"
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label-sm text-01 [overflow-wrap:anywhere]">{card.name}</span>
            <span className="font-mono text-mono-12 text-03 [overflow-wrap:anywhere]">
              @{card.handle}/{card.slug}
            </span>
          </div>
          <Chip tone={badgeTone(card.badge)}>{badgeLabel(card.badge)}</Chip>
        </div>
        {card.description ? <p className="line-clamp-2 text-body-13 text-02">{card.description}</p> : null}
        <p className="text-body-xs text-02">
          {card.toolCount} tool{card.toolCount === 1 ? "" : "s"} · {activeUsersText(card.activeUsers)}
          {facts.priceRange ? ` · ${facts.priceRange}` : ""}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {facts.unserved.length > 0 ? <Chip tone="warning">A tool has no provider</Chip> : null}
          {facts.noBackup.length > 0 ? <Chip tone="warning">No backup provider</Chip> : null}
          {facts.routesToPublisher ? <Chip tone="warning">Routes to its maker&apos;s own provider</Chip> : null}
          <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-03 group-hover:text-02" />
        </div>
      </Link>
    </li>
  );
}

/** The catalogue's Tool sets tab. The search box is the page's own. */
export function ToolsetCatalogue({ query, onClearQuery }: { query: string; onClearQuery: () => void }) {
  const [publisher, setPublisher] = React.useState<CatalogueToolsetFilters["publisher"]>(null);
  const [category, setCategory] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<CatalogueToolsetFilters["sort"]>("popular");
  // Typing asks the server once it pauses, not per keystroke (public reads are rate limited).
  const [q, setQ] = React.useState(query.trim());
  React.useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);
  const list = usePublicToolsets({ q: q || undefined, publisher: publisher ?? undefined, category: category ?? undefined, sort, limit: 60 });
  const categories = usePublicCategories();
  const tools = usePublicTools();
  const cards = list.data?.toolsets ?? [];
  const filtered = Boolean(query.trim() || publisher || category);

  return (
    <div className="flex flex-col gap-3" data-testid="toolset-catalogue">
      <div className="flex flex-col gap-2 tablet:flex-row tablet:flex-wrap tablet:items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who published it">
          {PUBLISHERS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={publisher === p.id}
              onClick={() => setPublisher(p.id)}
              className={cn(
                "min-h-10 rounded-full border px-3 text-label-xs tablet:py-1",
                publisher === p.id ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Topic"
          className="min-h-10 rounded-md border border-02 bg-01 px-3 text-body-13 text-01"
          value={category ?? ""}
          onChange={(e) => setCategory(e.target.value || null)}
        >
          <option value="">All topics</option>
          {(categories.data?.categories ?? [])
            .filter((c) => c.toolsets > 0)
            .map((c) => (
              <option key={c.category} value={c.category}>
                {c.category.charAt(0).toUpperCase() + c.category.slice(1)} · {c.toolsets}
              </option>
            ))}
        </select>
        <Segmented value={sort} onValueChange={(v) => setSort(v as CatalogueToolsetFilters["sort"])} aria-label="Order" className="inline-flex self-start rounded-md bg-03 p-0.5 tablet:ml-auto">
          <SegmentedItem value="popular">Popular</SegmentedItem>
          <SegmentedItem value="trending">Trending</SegmentedItem>
          <SegmentedItem value="new">New</SegmentedItem>
        </Segmented>
      </div>

      {list.isPending ? (
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2" aria-label="Loading tool sets">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-36 animate-pulse rounded-xl bg-02 motion-reduce:animate-none" />
          ))}
        </ul>
      ) : list.isError ? (
        <PageState
          kind="error"
          title="The tool sets could not be loaded"
          description={plainError(list.error instanceof ApiError ? list.error.code : "ERR_NETWORK")}
          onRetry={() => void list.refetch()}
        />
      ) : cards.length === 0 ? (
        filtered ? (
          <PageState
            kind="empty"
            title={query.trim() ? `No tool set matches “${query.trim()}”` : "No tool set here yet"}
            description="Search looks at a tool set's name, description, topic and tools."
            action={{
              label: "Show all tool sets",
              onClick: () => {
                setPublisher(null);
                setCategory(null);
                onClearQuery();
              },
            }}
          />
        ) : (
          <PageState
            kind="empty"
            icon={<Layers aria-hidden="true" width={22} height={22} />}
            title="No tool sets are listed yet"
            description="Tool sets are ready-made groups of tools with their own server URL. Make one from your tools and share it."
            action={{ label: "Make a tool set", href: "/toolsets/mine" }}
          />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
          {cards.map((card) => (
            <ToolsetCard key={`${card.handle}/${card.slug}`} card={card} catalogue={tools.data?.tools ?? null} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Explore › Tool sets (`/explore/toolsets`): the shared tool sets inside the
 * app, so a signed-in buyer does not have to leave for the public catalogue
 * to find one (review F-P1). The same list and filters as the catalogue's tab;
 * each card opens the tool set's page, where Connect adds it to an agent.
 */
export function ExploreToolsetsView() {
  const [query, setQuery] = React.useState("");
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:px-7 tablet:py-[18px]">
      <ExploreNav />
      <PageHeader
        title="Shared tool sets"
        subtitle="Ready-made groups of tools, each with its own server URL"
        actions={
          <>
            <Search
              wrapperClassName="w-full tablet:w-[300px]"
              placeholder="Search tool sets"
              aria-label="Search tool sets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button asChild variant="secondary">
              <Link href="/toolsets/mine">Your tool sets</Link>
            </Button>
          </>
        }
      />
      <ToolsetCatalogue query={query} onClearQuery={() => setQuery("")} />
    </div>
  );
}

/* ------------------------------------------------- a tool set's page */

const PENDING_TOKEN = "assay.toolsets.pending-token";

interface ViewParams {
  handle: string | null;
  slug: string | null;
  token: string | null;
  v: number | null;
  from: number | null;
}

function readViewParams(): ViewParams {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const num = (raw: string | null) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  let token = fragment.get("token");
  // Back from sign-in: the token was kept in this tab, never in the sign-in URL.
  if (!token && query.get("resume") === "1") {
    try {
      token = window.sessionStorage.getItem(PENDING_TOKEN);
    } catch {
      token = null;
    }
  }
  return {
    handle: query.get("handle")?.toLowerCase() ?? null,
    slug: query.get("slug")?.toLowerCase() ?? null,
    token: token && /^[a-z0-9_-]{22,64}$/i.test(token) ? token : null,
    v: num(fragment.get("v") ?? query.get("v")),
    from: num(query.get("from")),
  };
}

/** `/toolsets/view`: a listed tool set by its public name and slug, or a link-only one by its token. */
export function PublicToolsetView() {
  const [params, setParams] = React.useState<ViewParams | null>(null);
  React.useEffect(() => {
    const read = () => setParams(readViewParams());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const byName = usePublicToolset(params?.token ? null : params?.handle ?? null, params?.token ? null : params?.slug ?? null);
  const byToken = useToolsetByToken(params?.token ?? null, params?.v ?? null, params?.from ?? null);
  const query = params?.token ? byToken : byName;
  useDocumentTitle(
    query.data
      ? `${query.data.name} — Assay`
      : query.isError
        ? query.error instanceof ApiError && query.error.status === 404
          ? "Tool set not found — Assay"
          : "Tool set could not be loaded — Assay"
        : null,
  );

  const frame = (children: React.ReactNode) => <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">{children}</div>;
  if (!params || ((params.token || (params.handle && params.slug)) && query.isPending)) {
    return frame(<PageState kind="loading" rows={4} label="Loading the tool set" />);
  }
  if (!params.token && !(params.handle && params.slug)) {
    return frame(
      <PageState kind="empty" titleAsH1 title="Not found" description="This link does not name a tool set. Check it with whoever sent it." action={{ label: "See all tool sets", href: "/catalogue?view=toolsets" }} />,
    );
  }
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return frame(
      <PageState
        kind={missing ? "empty" : "error"}
        titleAsH1
        title={missing ? "Not found" : "This tool set could not be loaded"}
        description={
          missing
            ? params.token
              ? "This link no longer works: its owner stopped sharing it, or made a new link."
              : "No listed tool set has this name. It may have stopped being shared."
            : plainError(query.error instanceof ApiError ? query.error.code : "ERR_NETWORK")
        }
        {...(missing ? { action: { label: "See all tool sets", href: "/catalogue?view=toolsets" } } : { onRetry: () => void query.refetch() })}
      />,
    );
  }
  return frame(<ToolsetPublicBody page={query.data} token={params.token} v={params.v} from={params.from} />);
}

export function ToolsetPublicBody({ page, token, v, from }: { page: PublicToolsetPage; token: string | null; v: number | null; from: number | null }) {
  const tools = usePublicTools();
  const catalogue = tools.data?.tools ?? [];
  const versions = usePublicToolsetVersions(token ? null : page.handle, token ? null : page.slug);
  const facts = trustFacts(page, tools.data?.tools ?? null);
  const signedIn = useSignedIn() || demoEnabled();
  const [copying, setCopying] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const shownVersion = v ?? page.version;
  const latestUrl = page.mcpUrls.latest;
  // Another person's set is always handed out pinned (spec 9.3), also an Official one.
  const url = v ? `${latestUrl}@${v}` : page.mcpUrls.pinned;
  const official = page.badge === "OFFICIAL";
  // Link-only: "Start free" comes back without the token in any URL; it waits in this tab.
  const nextPath = token ? "/toolsets/view?resume=1" : undefined;
  const rememberToken = () => {
    if (!token) return;
    try {
      window.sessionStorage.setItem(PENDING_TOKEN, token);
    } catch {
      // Not kept: after sign-in the person opens the link again.
    }
  };
  const byId = new Map(catalogue.map((t) => [t.id, t]));

  return (
    <>
      <header className="flex flex-col gap-2" data-testid="toolset-public-header">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-heading-md text-01 [overflow-wrap:anywhere]">{page.name}</h1>
          <Chip tone={badgeTone(page.badge)}>
            {official ? <BadgeCheck aria-hidden="true" className="size-3" /> : null}
            {badgeLabel(page.badge)}
          </Chip>
          {token ? <Chip>Shared by link</Chip> : null}
        </div>
        <p className="text-body-13 text-02">
          by{" "}
          <Link href={`/toolsets/handle?handle=${encodeURIComponent(page.handle)}`} className="inline-flex min-h-10 items-center font-mono text-primary-600 hover:underline">
            @{page.handle}
          </Link>{" "}
          · v{shownVersion}
          {shownVersion === page.version ? (
            <>
              {" "}
              · published <UtcTime value={page.publishedAt} dateOnly midSentence /> UTC
            </>
          ) : null}
        </p>
        {page.description ? <p className="text-body-md text-02">{page.description}</p> : null}
        {page.forkedFrom ? (
          <p className="text-body-xs text-03">
            Made from{" "}
            <Link href={`/toolsets/view?handle=${page.forkedFrom.handle}&slug=${page.forkedFrom.slug}`} className="text-primary-600 hover:underline">
              @{page.forkedFrom.handle}/{page.forkedFrom.slug}
              {page.forkedFrom.version ? ` v${page.forkedFrom.version}` : ""}
            </Link>
          </p>
        ) : null}
      </header>

      {page.sharingEndsAt ? (
        <p role="status" className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="sharing-ends">
          This tool set stops working on {formatDate(page.sharingEndsAt)} UTC. Its owner stopped sharing it. Make your own version to keep using its tools.
        </p>
      ) : null}

      {from && from < page.version ? <UpdateBanner page={page} from={from} token={token} /> : null}

      <section aria-label="Before you connect" className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4" data-testid="trust-facts">
        <h2 className="text-label-13 text-01">Before you connect</h2>
        <ul className="flex flex-col gap-1.5 text-body-13">
          <li className="text-01">{facts.priceRange ? `Costs ${facts.priceRange.replace(/^Free calls, then /, "free calls, then ")}.` : tools.isPending ? "Prices loading…" : "Prices not known yet."}</li>
          {facts.unserved.length > 0 ? (
            <li className="flex items-start gap-1.5 text-warning-700">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Nobody serves {facts.unserved.join(", ")} yet: calls to {facts.unserved.length === 1 ? "it" : "them"} fail.
            </li>
          ) : null}
          {facts.noBackup.length > 0 ? (
            <li className="flex items-start gap-1.5 text-warning-700">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              No backup provider for {facts.noBackup.join(", ")}: if its one provider is down, the call fails.
            </li>
          ) : facts.allBackedUp ? (
            <li className="text-02">Every tool has a backup provider.</li>
          ) : null}
          {facts.notReviewed.length > 0 ? (
            <li className="flex items-start gap-1.5 text-warning-700">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {`Not reviewed: ${facts.notReviewed.join(", ")} ${facts.notReviewed.length === 1 ? "is" : "are"} one maker's own API, not checked by Assay.`}
            </li>
          ) : null}
          {facts.routesToPublisher ? (
            <li className="flex items-start gap-1.5 text-warning-700">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Routes to the publisher&apos;s own provider: its rules send calls only to the company that published it.
            </li>
          ) : null}
          {facts.removed.length > 0 ? <li className="text-02">Removed by their maker: {facts.removed.join(", ")}.</li> : null}
        </ul>
      </section>

      <div onClickCapture={rememberToken}>
        <ConnectPanel
          publicPage
          url={url}
          nextPath={nextPath}
          connectLabel="Use this tool set"
          title={`Connect ${page.name}`}
          detail={`Locked to v${shownVersion}, so it never changes under your agent. You choose when to update.`}
        />
      </div>

      <section aria-label="Tools" className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4" data-testid="public-tools">
        <h2 className="text-label-md text-01">Tools</h2>
        <ul className="flex flex-col divide-y divide-01">
          {page.entries.map((e) => {
            const tool = byId.get(e.toolId);
            const shown = toolDisplay({ name: e.toolName, toolId: e.toolId });
            const price = tool ? priceRangeText([tool]) : null;
            return (
              <li key={e.toolId} className="flex flex-col gap-0.5 py-2 tablet:flex-row tablet:items-center tablet:gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{shown.name}</span>
                  <span className="text-body-xs text-03">{shown.title ?? humanToolName(shown.name)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-body-xs text-02">
                  {e.removed ? <Chip tone="danger">Removed</Chip> : null}
                  {e.notReviewed ? <Chip tone="warning">Not reviewed</Chip> : null}
                  {price ? <span className="text-01">{price} · </span> : null}
                  {e.providerMode === "BEST" ? PROVIDER_MODE_LABELS.BEST : `${PROVIDER_MODE_LABELS[e.providerMode as "ONLY" | "EXCLUDE"] ?? "Chosen providers"}: ${e.providerCount}`}
                  {tool ? ` · ${tool.providerCount} provider${tool.providerCount === 1 ? "" : "s"}` : ""}
                  {e.minTier ? " · only verified providers" : ""}
                  {contractChipParts(e, tool?.versions ? currentMajorOf(tool.versions) : null).map((part) => ` · ${part}`)}
                  {tool?.versions ? <EntryVersionWarning range={e.toolVersionRange} versions={tool.versions} /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Usage" className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4" data-testid="public-stats">
        <h2 className="text-label-md text-01">Who uses it</h2>
        <FigureGrid rows={statRows(page.stats)} weekStart={page.stats.weekStart} />
      </section>

      {token ? null : (
        <section aria-label="Versions" className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4" data-testid="public-versions">
          <h2 className="text-label-md text-01">Versions</h2>
          {versions.isPending ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : (versions.data?.versions ?? []).length === 0 ? (
            <p className="text-body-13 text-02">No earlier versions.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-01">
              {versions.data!.versions.map((x) => (
                <li key={x.version} className="flex flex-col gap-1 py-2">
                  <span className="flex flex-wrap items-center gap-2 text-label-13 text-01">
                    v{x.version}
                    <span className="font-normal text-03">
                      <UtcTime value={x.publishedAt} dateOnly /> UTC · {x.toolCount} tool{x.toolCount === 1 ? "" : "s"}
                    </span>
                    {x.version === page.version ? <Chip tone="primary">Newest</Chip> : null}
                  </span>
                  <span className="text-body-13 text-02">{x.changelog ?? "No notes."}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <CopyButton value={`${latestUrl}@${x.version}`} label={`Copy v${x.version} URL`} />
                    <span className="text-body-xs text-03">{lockLabel(x.version)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-center" data-testid="public-actions">
        <p className="min-w-0 flex-1 text-body-13 text-02">Want different provider rules? {MAKE_MY_OWN_HINT}</p>
        <div className="flex flex-wrap gap-2">
          {signedIn ? (
            <Button variant="secondary" icon={<CopyIcon />} onClick={() => setCopying(true)}>
              {MAKE_MY_OWN_LABEL}
            </Button>
          ) : (
            <Button asChild variant="secondary" onClick={rememberToken}>
              <Link href={loginHref({ next: nextPath ?? `/toolsets/view?handle=${page.handle}&slug=${page.slug}` })}>Start free to copy it</Link>
            </Button>
          )}
          <Button variant="ghost" icon={<Flag />} onClick={() => setReporting(true)} disabled={!signedIn} title={signedIn ? undefined : "Sign in to report"}>
            Report
          </Button>
        </div>
      </section>

      <CopyToolsetSheet
        open={copying}
        onOpenChange={setCopying}
        source={{ id: page.id, name: page.name, handle: page.handle, slug: page.slug, version: shownVersion, unlistedToken: token, entries: page.entries }}
      />
      <ReportSheet
        open={reporting}
        onOpenChange={setReporting}
        label={`@${page.handle}/${page.slug}`}
        target={{ toolsetId: page.id, ...(token ? { unlistedToken: token } : {}) }}
      />
    </>
  );
}

/** Opened from the update alert: what changed since the version in use, and the new URL. */
function UpdateBanner({ page, from, token }: { page: PublicToolsetPage; from: number; token: string | null }) {
  const detail = usePublicToolsetVersion(token ? null : page.handle, token ? null : page.slug, page.version, from);
  // The version in use, for what changed in each tool's rule.
  const before = usePublicToolsetVersion(token ? null : page.handle, token ? null : page.slug, from, null);
  const beforeLink = useToolsetByToken(token, from);
  const fromEntries = (token ? beforeLink.data?.entries : before.data?.entries) ?? null;
  const ruleOf = fromEntries ? ruleDetails(fromEntries, page.entries, (e) => e) : undefined;
  const tools = usePublicTools();
  const diff = page.diff ?? detail.data?.diff ?? null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-primary-20 bg-primary-10 p-4" data-testid="update-banner">
      <h2 className="text-label-md text-01">
        v{page.version} is out. You use v{from}.
      </h2>
      {diff ? (
        <DiffView diff={diff} priceOf={(name) => priceOfTool(tools.data?.tools ?? [], name)} ruleOf={ruleOf} />
      ) : detail.isPending && !token ? (
        <Skeleton className="h-12 w-full" />
      ) : page.changelog ? (
        <p className="text-body-13 text-02">{page.changelog}</p>
      ) : null}
      <CopyLine value={page.mcpUrls.pinned} label={`Copy v${page.version} URL`} testId="update-copy" />
      <p className="text-body-xs text-03">Your app still uses v{from} until you replace it.</p>
    </section>
  );
}

/* -------------------------------------------------- a public name's page */

/** `/toolsets/handle?handle=`: the tool sets a public name has listed, and Report. */
export function PublicHandleView() {
  const [handle, setHandle] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("handle")?.replace(/^@/, "").toLowerCase() ?? null;
    setHandle(raw && /^[a-z][a-z0-9-]{2,23}$/.test(raw) ? raw : null);
  }, []);
  const profile = usePublicHandle(handle ?? null);
  const tools = usePublicTools();
  const signedIn = useSignedIn() || demoEnabled();
  const [reporting, setReporting] = React.useState(false);
  const frame = (children: React.ReactNode) => <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">{children}</div>;
  useDocumentTitle(profile.data ? `@${profile.data.handle} — Assay` : handle === null || profile.isError ? "Not found — Assay" : null);

  if (handle === undefined || (handle && profile.isPending)) return frame(<PageState kind="loading" rows={3} label="Loading" />);
  if (!handle || profile.isError || !profile.data) {
    const missing = !handle || (profile.error instanceof ApiError && profile.error.status === 404);
    return frame(
      <PageState
        kind={missing ? "empty" : "error"}
        titleAsH1
        title="Not found"
        description={missing ? "No one uses this public name." : plainError(profile.error instanceof ApiError ? profile.error.code : "ERR_NETWORK")}
        {...(missing ? { action: { label: "See all tool sets", href: "/catalogue?view=toolsets" } } : { onRetry: () => void profile.refetch() })}
      />,
    );
  }
  const data = profile.data;
  return frame(
    <>
      <header className="flex flex-col gap-1" data-testid="handle-header">
        <h1 className="break-all font-mono text-heading-md text-01">@{data.handle}</h1>
        {data.renamedTo ? (
          <p className="text-body-13 text-warning-700">
            This public name changed to{" "}
            <Link href={`/toolsets/handle?handle=${data.renamedTo}`} className="font-mono underline">
              @{data.renamedTo}
            </Link>
            .
          </p>
        ) : null}
        <p className="text-body-13 text-02">
          {data.handle === "assay" ? "Official tool sets, kept up to date by Assay." : `The tools and tool sets @${data.handle} lists in the catalogue.`}
        </p>
      </header>
      {data.tools.length > 0 ? (
        <ConnectPanel
          publicPage
          url={data.mcpUrl ?? buildMcpUrl({ kind: "maker", handle: data.handle }, { free: false }, mcpHost())}
          title={`Connect every tool from @${data.handle}`}
          copyable
          detail={<span data-testid="handle-connect-hint">Add this URL to your agent app as an MCP server: every listed tool of @{data.handle} becomes one server.</span>}
        />
      ) : null}
      {data.tools.length > 0 ? <HandleTools handle={data.handle} tools={data.tools} catalogue={tools.data?.tools ?? []} /> : null}
      {data.toolsets.length === 0 ? (
        data.tools.length > 0 ? null : (
          <PageState kind="empty" title={`@${data.handle} has not listed a tool set yet`} description="Tools and tool sets shared only by link do not show here." action={{ label: "See all tool sets", href: "/catalogue?view=toolsets" }} />
        )
      ) : (
        <>
        {data.tools.length > 0 ? (
          <p className="text-body-xs text-03" data-testid="toolset-review-note">
            Tool sets are not reviewed as a whole: each one is a list of tools with rules, and each tool in it shows its own review state on its page.
          </p>
        ) : null}
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2" data-testid="handle-toolsets">
          {data.toolsets.map((card) => (
            <ToolsetCard key={card.slug} card={card} catalogue={tools.data?.tools ?? null} />
          ))}
        </ul>
        </>
      )}
      {data.handle === "assay" ? null : (
        <div>
          <Button variant="ghost" icon={<Flag />} onClick={() => setReporting(true)} disabled={!signedIn}>
            Report @{data.handle}
          </Button>
          {signedIn ? null : (
            <p className="text-body-xs text-03">
              <Link href={loginHref({ next: `/toolsets/handle?handle=${data.handle}` })} className="text-primary-600 hover:underline">
                Sign in
              </Link>{" "}
              to report it.
            </p>
          )}
        </div>
      )}
      <ReportSheet open={reporting} onOpenChange={setReporting} label={`@${data.handle}`} target={{ handle: data.handle }} />
    </>,
  );
}

/**
 * A public name's own tools (`{handle}__{tool}`): LISTED ones only, so each
 * was reviewed; one maker serves each, so none has a backup provider. The
 * tier is at most "Verified".
 */
export function HandleTools({ handle, tools, catalogue = [] }: { handle: string; tools: PublicHandleTool[]; catalogue?: readonly PublicTool[] }) {
  const priceOf = (id: string) => {
    const row = catalogue.find((t) => t.id === id);
    if (!row) return null;
    if (row.pricingMode === "FREE") return "Free";
    return row.price ? `${formatMoney(row.price, { decimals: 4 })} a call` : null;
  };
  return (
    <section aria-labelledby="handle-tools-title" className="flex flex-col gap-2" data-testid="handle-tools">
      <h2 id="handle-tools-title" className="text-label-md text-01">
        Tools by @{handle} <span className="text-body-13 text-03">· {tools.length}</span>
      </h2>
      <p className="text-body-13 text-03">One maker&apos;s own APIs: only @{handle} serves them, so there is no backup provider. Each one was reviewed by Assay before it was listed.</p>
      <p className="text-body-xs text-03" data-testid="tier-explainer">
        <span className="text-label-xs text-02">Verified</span>: the reviewer vouches that it does what it says. <span className="text-label-xs text-02">Unverified</span>: listed, but its answers could not be judged as well. A maker&apos;s own API is never Guaranteed.
      </p>
      <ul className="flex flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
        {tools.map((tool) => (
          <li key={tool.id}>
            <Link href={routes.publicTool(tool.id)} className="group flex w-full items-center gap-3 px-4 py-3.5 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
                  {tool.tier === "VERIFIED" ? (
                    <Chip tone="success">
                      <BadgeCheck aria-hidden="true" className="size-3" />
                      Verified
                    </Chip>
                  ) : (
                    <Chip>Unverified</Chip>
                  )}
                  {tool.reviewed ? (
                    <Chip>Reviewed</Chip>
                  ) : (
                    <Chip tone="warning">
                      <ShieldAlert aria-hidden="true" className="size-3" />
                      Not reviewed
                    </Chip>
                  )}
                  {tool.version ? <span className="text-body-xs text-03">v{tool.version}</span> : null}
                </span>
                {tool.summary ? <span className="line-clamp-2 text-body-13 text-02">{tool.summary}</span> : null}
                <span className="text-body-xs text-03">
                  {priceOf(tool.id) ? `${priceOf(tool.id)} · ` : ""}
                  {tool.category}
                  {tool.replacementName ? ` · now also a standard tool with backups: ${tool.replacementName}` : ""}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03 group-hover:text-02" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On a public entry: its versions are all on their way out (a deprecated or retired major). */
function EntryVersionWarning({ range, versions }: { range: string | null | undefined; versions: readonly ToolVersionBrief[] }) {
  const warning = entryContractWarning(range, versions);
  if (!warning) return null;
  return (
    <Chip tone={warning.tone} className="whitespace-normal">
      {warning.text}
    </Chip>
  );
}
