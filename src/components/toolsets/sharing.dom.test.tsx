import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import type { PublicToolsetPage } from "@/services/public-toolsets.service";
import type { PublicTool } from "@/services/public-explorer.service";
import type { CopyResult, ServersInUse as ServersInUseData, Toolset, ToolsetVersion } from "@/services/toolsets.service";

import { ToolsetCard, ToolsetPublicBody } from "./public-toolsets";
import { ServersInUse } from "./servers-in-use";
import { ShareBody } from "./share-dialog";
import { CopyExclusions, DiffView, FigureGrid } from "./toolset-bits";
import { statRows } from "@/features/toolsets/public";
import { toolsetKeys } from "./use-toolsets";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const ASSET = "eip155:46630/erc20:0x915E";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const HOST = "https://<your-mcp-host>";

function render(node: React.ReactNode, seed: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["agents"], { items: [{ agentId: "a1", label: "research-bot" }], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  seed(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const ENTRY = {
  position: 0,
  toolId: "t-search",
  toolName: "search_web",
  category: "web",
  providerMode: "BEST" as const,
  providerIds: [],
  minTier: null,
  maxPrice: null,
  minQuality: null,
  onEmpty: "FAIL" as const,
};

function toolset(patch: Partial<Toolset> = {}): Toolset {
  return {
    id: "s1",
    slug: "research",
    name: "Research kit",
    description: null,
    category: "web",
    tags: [],
    icon: null,
    visibility: "PRIVATE",
    discovery: "AUTO",
    searchThreshold: 25,
    pinnedTools: [],
    mcpUrl: `${HOST}/my/research`,
    toolCount: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    latestVersion: null,
    handle: null,
    entries: [ENTRY, { ...ENTRY, position: 1, toolId: "t-sum", toolName: "summarize_document", onEmpty: "FALLBACK_BEST" }],
    ...patch,
  };
}

function inSheet(node: React.ReactNode) {
  return <Sheet open>{node}</Sheet>;
}

describe("the Share dialog", () => {
  it("first time: starts at Only my team and publishes nothing until a choice; changelog filled in; Draft and versions explained", () => {
    const out = text(
      render(inSheet(<ShareBody set={toolset()} onDone={() => undefined} />), (c) => c.setQueryData(toolsetKeys.handle, { handle: null, status: null, lockedAt: null, canChange: true })),
    );
    expect(out).toContain("Who can use it?");
    expect(out).toContain("Only my team");
    expect(out).toContain("Anyone with the link");
    expect(out).toContain("Listed in the catalogue");
    expect(out).toContain("Only my team · now");
    expect(out).not.toContain("Your public name");
    expect(out).toContain("Choose who can use it above. Nothing is shared until you do.");
    expect(out).toContain("Save as v1");
    expect(out).toContain("First version: 2 tools: search_web and summarize_document.");
    expect(out).toContain("Changes reach your agents immediately.");
    expect(out).toContain("Versions are frozen copies");
    expect(out).not.toMatch(/UNLISTED|PUBLIC|PRIVATE|handle|toolset/);
  });

  it("once shared: the link comes first with Copy, the diff since v3, Stop sharing", () => {
    const set = toolset({
      visibility: "PUBLIC",
      latestVersion: 3,
      handle: "acme",
      listingStatus: "LISTED",
      urls: { draft: `${HOST}/my/research`, myPinned: `${HOST}/my/research@3`, public: `${HOST}/@acme/research`, publicPinned: `${HOST}/@acme/research@3`, unlisted: null, unlistedPinned: null },
    });
    const v3: ToolsetVersion = {
      version: 3,
      publishedAt: "2026-10-10T00:00:00.000Z",
      changelog: "x",
      name: "Research kit",
      toolCount: 2,
      description: null,
      icon: null,
      discovery: "AUTO",
      searchThreshold: 25,
      pinnedTools: [],
      entries: [ENTRY, { ...ENTRY, toolId: "t-sum", toolName: "summarize_document", onEmpty: "FAIL" }],
    };
    const out = text(
      render(inSheet(<ShareBody set={set} onDone={() => undefined} />), (c) => {
        c.setQueryData(toolsetKeys.handle, { handle: "acme", status: "ACTIVE", lockedAt: "2026-10-01T00:00:00.000Z", canChange: false });
        c.setQueryData(toolsetKeys.version("s1", 3), v3);
      }),
    );
    expect(out).toContain("Listed in the catalogue. Anyone can connect it with this URL:");
    expect(out).toContain(`${HOST}/@acme/research@3`);
    expect(out).toContain("Copy link");
    expect(out).toContain("Stop sharing");
    expect(out).not.toContain("New link");
    expect(out).toContain("Changed provider rules for summarize_document");
    expect(out).toContain("Share v4");
    expect(out).toContain("Shared as @acme/research");
  });

  it("link-only: offers a new link", () => {
    const set = toolset({
      visibility: "UNLISTED",
      latestVersion: 1,
      urls: { draft: "", myPinned: null, public: null, publicPinned: null, unlisted: `${HOST}/u/k7q2m9x4p1w8z3n6r5t0vb`, unlistedPinned: `${HOST}/u/k7q2m9x4p1w8z3n6r5t0vb@1` },
    });
    const out = text(render(inSheet(<ShareBody set={set} onDone={() => undefined} />), (c) => c.setQueryData(toolsetKeys.handle, { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: false })));
    expect(out).toContain("Anyone with this link can connect it:");
    expect(out).toContain("New link");
  });
});

const CATALOGUE: PublicTool[] = [
  { id: "t1", name: "get_token_market", description: "", tier: "VERIFIED", providerCount: 3, fromPrice: usd("2200"), price: usd("3000"), pricingMode: "PAID", routable: true, settlementChains: null, paidBindings: 1, freeCallsPerDay: null, summary: "", version: null, versions: [], deprecatedMajors: [], replacementToolId: null, replacementName: null, replacementMajor: null, replacementVersion: null },
  { id: "t2", name: "Market quote", description: "", tier: "VERIFIED", providerCount: 1, fromPrice: usd("450000"), price: usd("450000"), pricingMode: "PAID", routable: true, settlementChains: null, paidBindings: 1, freeCallsPerDay: null, summary: "", version: null, versions: [], deprecatedMajors: [], replacementToolId: null, replacementName: null, replacementMajor: null, replacementVersion: null },
];

const CARD = {
  id: "ts1",
  handle: "geodesk",
  slug: "travel-planner",
  name: "Travel planner",
  description: "Where is it and what does a euro cost.",
  category: "finance",
  tags: [],
  icon: null,
  badge: "COMMUNITY",
  version: 1,
  toolCount: 2,
  toolIds: ["t1", "t2"],
  activeUsers: { value: null, display: "Fewer than 5" },
  mcpUrls: { latest: `${HOST}/@geodesk/travel-planner`, pinned: `${HOST}/@geodesk/travel-planner@1`, recommended: `${HOST}/@geodesk/travel-planner@1` },
  routesToPublisher: false,
};

describe("public tool sets", () => {
  it("a card shows name, @name, badge, tool count, users below k and the price range from the catalogue", () => {
    const out = text(render(<ul><ToolsetCard card={CARD} catalogue={CATALOGUE} /></ul>));
    expect(out).toContain("Travel planner");
    expect(out).toContain("@geodesk/travel-planner");
    expect(out).toContain("Community");
    expect(out).toContain("2 tools · Fewer than 5 users · $0.0022–$0.45 a call");
    expect(out).toContain("No backup provider");
  });

  it("a page puts the trust facts above Connect, then tools, figures, versions, Make my own version and Report", () => {
    const page: PublicToolsetPage = {
      ...CARD,
      changelog: "First version: 2 tools.",
      publishedAt: "2026-10-13T00:00:00.000Z",
      entries: [
        { toolId: "t1", toolName: "get_token_market", providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL", removed: false, notReviewed: false },
        { toolId: "t2", toolName: "Market quote", providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL", removed: false, notReviewed: false },
      ],
      stats: { weekStart: "2026-10-12", activeUsers: { value: null, display: "Fewer than 5" }, agents: null, calls30d: null, copies: { value: null, display: "Fewer than 5" }, trend: null, onLatestVersionPercent: null },
      forkedFrom: null,
      sharingEndsAt: null,
      notReviewed: false,
      routesToPublisher: true,
    };
    const html = render(<ToolsetPublicBody page={page} token={null} v={null} from={null} />, (c) => {
      c.setQueryData(["public", "tools"], { tools: CATALOGUE });
      c.setQueryData(toolsetKeys.publicVersions("geodesk", "travel-planner"), { versions: [{ version: 1, publishedAt: page.publishedAt, changelog: page.changelog, toolCount: 2 }] });
    });
    const out = text(html);
    const order = ["Before you connect", "Connect Travel planner", "Tools", "Who uses it", "Versions", "Change rules. Doesn't get updates.", "Report"].map((s) => out.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("No backup provider for Market quote");
    expect(out).toContain("Routes to the publisher's own provider");
    expect(out).toContain("Locked to v1, so it never changes under your agent.");
    expect(out).toContain("Start free");
    expect(out).toContain("Fewer than 5");
    expect(out).toContain("Lock to v1 (no surprise changes)");
    expect(out).toContain("Change rules. Doesn't get updates.");
  });

  it("opened from the update alert: what changed, Copy v3 URL, and that the app keeps v2", () => {
    const page: PublicToolsetPage = {
      ...CARD,
      version: 3,
      mcpUrls: { latest: `${HOST}/@geodesk/travel-planner`, pinned: `${HOST}/@geodesk/travel-planner@3`, recommended: `${HOST}/@geodesk/travel-planner@3` },
      changelog: "Added get_usd_eur_rate.",
      publishedAt: "2026-10-15T00:00:00.000Z",
      entries: [],
      stats: { weekStart: null, activeUsers: null, agents: null, calls30d: null, copies: null, trend: null, onLatestVersionPercent: null },
      forkedFrom: null,
      sharingEndsAt: null,
      notReviewed: false,
    };
    const out = text(
      render(<ToolsetPublicBody page={page} token={null} v={3} from={2} />, (c) => {
        c.setQueryData(toolsetKeys.publicVersions("geodesk", "travel-planner"), {
          versions: [
            { version: 3, publishedAt: page.publishedAt, changelog: "Added get_usd_eur_rate.", toolCount: 3 },
            { version: 2, publishedAt: page.publishedAt, changelog: "Earlier.", toolCount: 2 },
          ],
        });
        c.setQueryData(toolsetKeys.publicVersion("geodesk", "travel-planner", 3, 2), {
          diff: { from: 2, to: 3, added: ["get_usd_eur_rate"], removed: [], rulesChanged: ["get_token_market"], settingsChanged: [] },
        });
        c.setQueryData(["public", "tools"], { tools: [{ ...CATALOGUE[0]!, id: "fx", name: "get_usd_eur_rate", fromPrice: usd("800"), price: usd("1000") }] });
      }),
    );
    expect(out).toContain("v3 is out. You use v2.");
    expect(out).toContain("get_usd_eur_rate added · $0.0008–$0.001 a call");
    expect(out).toContain("get_token_market provider rules changed");
    expect(out).toContain("Copy v3 URL");
    expect(out).toContain("Your app still uses v2 until you replace it.");
    expect(out).toContain("No figures yet.");
  });

  it("copy exclusions name each tool and its reason", () => {
    const result: CopyResult = {
      toolset: toolset({ name: "Desk tools", toolCount: 2 }),
      excluded: [
        { toolId: "x1", toolName: "cobalt__news_search", reason: "LINK_ONLY" },
        { toolId: "x2", toolName: "transcribe_audio", reason: "REMOVED" },
      ],
    };
    const out = text(render(<CopyExclusions result={result} source={{ handle: "marketkit" }} />));
    expect(out).toContain("Desk tools is yours now, with 2 tools. 2 tools were left out:");
    // The maker is the tool's own (cobalt), not the tool set's publisher.
    expect(out).toContain("cobalt__news_search is @cobalt's link-only tool");
    expect(out).toContain("transcribe_audio was removed by its maker");
    expect(out).toContain("Keep @cobalt's link connected to use it.");
    expect(out).not.toContain("@marketkit");
  });

  it("the diff view and k-hidden figures", () => {
    const diff = text(render(<DiffView diff={{ added: ["a_b"], removed: ["c_d"], rulesChanged: [], settingsChanged: ["pinnedTools"] }} />));
    expect(diff).toContain("a_b added");
    expect(diff).toContain("c_d removed");
    expect(diff).toContain("Changed always-loaded tools");
    const grid = text(render(<FigureGrid rows={statRows({ activeUsers: { value: null, display: "Fewer than 5" }, agents: null, calls30d: null, copies: { value: null, display: "Fewer than 5" }, trend: null, onLatestVersionPercent: null })} weekStart="2026-10-12" />));
    expect(grid).toContain("Active users (30 days) Fewer than 5");
    expect(grid).not.toMatch(/\b0\b/);
    expect(grid).toContain("at least 5 teams");
  });
});

describe("Servers in use: over budget and Update available", () => {
  it("counts only servers that show every tool and offers 'Switch … to search'; a locked server shows the chip", () => {
    const data: ServersInUseData = {
      overBudget: true,
      servers: [
        {
          canonicalUrl: `${HOST}/?discovery=full`,
          endpointKind: "ROOT",
          toolsetId: null,
          name: "assay",
          serverName: "assay",
          client: "cursor",
          toolCount: 21,
          estimatedTokens: 4800,
          discovery: "FULL",
          searchUrl: `${HOST}/`,
          lastCallAt: "2026-10-17T10:00:00.000Z",
          handedOutAt: null,
          firstCallAt: null,
          waitingForFirstCall: false,
          available: true,
          updateAvailable: false,
        },
        {
          canonicalUrl: `${HOST}/@marketkit/crypto-research@2`,
          endpointKind: "TOOLSET",
          toolsetId: "ts9",
          name: "Crypto research desk",
          serverName: "crypto",
          client: "cursor",
          toolCount: 6,
          estimatedTokens: 1400,
          discovery: "FULL",
          searchUrl: `${HOST}/@marketkit/crypto-research@2?discovery=search`,
          lastCallAt: "2026-10-17T10:00:00.000Z",
          handedOutAt: null,
          firstCallAt: null,
          waitingForFirstCall: false,
          available: true,
          updateAvailable: true,
        },
        {
          canonicalUrl: `${HOST}/c/web`,
          endpointKind: "CATEGORY",
          toolsetId: null,
          name: "web",
          serverName: "web",
          client: "cursor",
          toolCount: 4,
          estimatedTokens: 700,
          discovery: "SEARCH",
          searchUrl: null,
          lastCallAt: null,
          handedOutAt: null,
          firstCallAt: null,
          waitingForFirstCall: false,
          available: true,
          updateAvailable: false,
        },
      ],
    };
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), data)));
    expect(out).toContain("The servers that show every tool show 27 between them, more than 25.");
    expect(out).toContain("The biggest is “Everything, all tools listed” (in your app: assay), with 21 tools.");
    expect(out).toContain("Switch it to search");
    expect(out).toContain("Update available · your app uses v2");
    expect(out).toContain("@marketkit/crypto-research · locked to v2");
    expect(out).toContain("· search");
  });
});
