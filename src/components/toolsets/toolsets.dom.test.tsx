import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import type { AgentAccess, McpUrlPreview, RefusedCall, ServersInUse as ServersInUseData } from "@/services/toolsets.service";

import { AccessEditor } from "./agent-access-card";
import { ResultLine } from "./connect-sheet";
import { RefusedCallCard } from "./refused-calls";
import { ServersInUse } from "./servers-in-use";
import { toolsetKeys } from "./use-toolsets";

const ASSET = "eip155:46630/erc20:0x915E";
const PROVIDERS = [
  { providerId: "p-acme", legalName: "Acme Data", verified: true, verifiedAt: null, tier: "ESTABLISHED", toolIds: ["t-tw"], activeBindings: 1, fromPrice: null, stake: [], quality: null },
  { providerId: "p-north", legalName: "Northwind Geo", verified: true, verifiedAt: null, tier: "NEW", toolIds: ["t-w"], activeBindings: 1, fromPrice: null, stake: [], quality: null },
];

function render(node: React.ReactNode, seed: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["catalogue", "providers"], { providers: PROVIDERS });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["agents"], { items: [{ agentId: "a1", label: "research-bot" }], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["spend-policy"], null);
  seed(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Text only, whitespace folded — what a reader sees. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const REFUSED: RefusedCall = {
  callId: "c1",
  agentId: "a1",
  toolId: "t-tw",
  toolName: "acme__search_tweets",
  refusalCode: "NO_PROVIDER_MATCHES_RULES",
  refusalLayer: "AGENT_LIMITS",
  charged: false,
  providers: [{ providerId: "p-acme", providerName: "Acme Data", reason: "EXCLUDED_BY_AGENT", source: "AGENT", detail: "Excluded by the agent's rules" }],
  endpointKind: "TOOLSET",
  toolsetId: null,
  toolsetVersion: null,
  viewFilter: null,
  createdAt: "2026-10-17T14:02:00.000Z",
};

describe("the refused-call view (sketch B)", () => {
  it("says not charged, the plain reason, the layer, each provider with its reason and the one-click fix", () => {
    const out = text(render(<RefusedCallCard call={REFUSED} />));
    expect(out).toContain("Call refused · not charged");
    expect(out).toContain("acme__search_tweets");
    expect(out).toContain("No provider fits your limits.");
    expect(out).toContain("Refused by this agent's provider limits. Nothing was charged.");
    expect(out).toContain("Acme Data");
    expect(out).toContain("Blocked by this agent's provider limits");
    expect(out).toContain("Remove from limits");
    expect(out).toContain("This tool has one provider, so nothing else can run it.");
    // UTC, labelled; the first render prints the exact instant.
    expect(out).toContain("14:02");
    expect(out).toContain("UTC");
  });

  it("not allowed: the fix is Allow this tool, with no provider list", () => {
    const out = text(render(<RefusedCallCard call={{ ...REFUSED, refusalCode: "TOOL_NOT_ALLOWED", providers: [] }} />));
    expect(out).toContain("This agent isn't allowed to use it.");
    expect(out).toContain("Refused by this agent's tool list");
    expect(out).not.toMatch(/agent's limits/);
    expect(out).toContain("Allow this tool");
    expect(out).not.toContain("one provider");
  });
});

const ACCESS: AgentAccess = {
  agentId: "a1",
  scope: "AGENT",
  policyVersion: 3,
  accessMode: "RESTRICTED",
  allowedToolsets: [{ toolsetId: "s1", version: null, viaUrlOnly: true, name: "Research kit", slug: "research", deleted: false }],
  allowedToolIds: ["t-w"],
  rules: { excludeProviderIds: ["p-acme"], maxPrice: { amount: "10000", asset: ASSET, decimals: 6 }, minTier: "ESTABLISHED", minQuality: null },
  pinnedTools: [],
  tools: [
    { toolId: "t-w", name: "get_weather", category: "weather", access: "ALLOWED", providersTotal: 4, providersLeft: 2 },
    { toolId: "t-tw", name: "acme__search_tweets", category: "social", access: "BLOCKED", providersTotal: 1, providersLeft: 0 },
  ],
};

describe("What this agent can use", () => {
  it("shows the choice, the tool sets and tools to tick with each result, and the provider limits", () => {
    const out = text(
      render(<AccessEditor access={ACCESS} agentName="research-bot" />, (c) =>
        c.setQueryData(toolsetKeys.all, {
          items: [{ id: "s1", slug: "research", name: "Research kit", toolCount: 4 }],
          pageInfo: { nextCursor: null, hasMore: false },
        }),
      ),
    );
    expect(out).toContain("Can use 1 of 2 tools.");
    expect(out).toContain("Everything");
    expect(out).toContain("Only these tool sets and tools");
    expect(out).toContain("Shortcut: only what's connected");
    expect(out).toContain("Research kit");
    expect(out).toContain("Only through its own URL");
    expect(out).toContain("Select all");
    expect(out).toContain("Clear all");
    expect(out).toContain("2 of 4 providers left (your limits: max $0.01, only verified, 1 provider excluded)");
    expect(out).toContain("not in this agent's list");
    expect(out).toContain("Provider limits");
    expect(out).toContain("Never use these providers");
    expect(out).toContain("Acme Data");
    expect(out).toContain("Only verified providers");
    // Nothing is unsaved yet: no save bar.
    expect(out).not.toContain("Save changes");
  });

  it("never shows the internal words, nor per-key narrowing", () => {
    const out = text(render(<AccessEditor access={ACCESS} agentName="research-bot" />));
    expect(out).not.toMatch(/RESTRICTED|ESTABLISHED|access policy|FALLBACK|discovery/i);
    expect(out).not.toMatch(/per key|this key only/i);
  });

  it("a deleted tool set says so", () => {
    const out = text(
      render(<AccessEditor access={{ ...ACCESS, allowedToolsets: [{ ...ACCESS.allowedToolsets[0]!, deleted: true, name: null }] }} agentName="research-bot" />),
    );
    expect(out).toContain("deleted by its owner");
  });

  it("explains inline when a server is Everything, and turns the shortcut off", () => {
    const html = render(<AccessEditor access={ACCESS} agentName="research-bot" />, (c) =>
      c.setQueryData(toolsetKeys.servers("a1"), { overBudget: false, servers: [{ ...SERVERS.servers[0]!, canonicalUrl: "https://mcp.example.com/", toolsetId: null }] }),
    );
    expect(text(html)).toContain("One of research-bot's servers is Everything");
  });

  it("phone: rows stack and long names break anywhere instead of one letter per line", () => {
    const html = render(<AccessEditor access={ACCESS} agentName="research-bot" />);
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("min-w-[8rem]");
    expect(html).toContain("min-h-10");
  });
});

const PREVIEW: McpUrlPreview = {
  canonicalUrl: "https://mcp.example.com/my/research",
  endpointKind: "TOOLSET",
  toolsetId: "s1",
  toolsetName: "Research kit",
  viewFilter: null,
  discovery: "FULL",
  listedCount: 1,
  estimatedTokens: 920,
  freeOnly: false,
  tools: [{ toolId: "t-w", name: "get_weather", category: "weather", listed: true, allowed: true, pricingMode: "PAID", price: "up to $0.002", providerCount: 3, noProviderFits: false }],
  ignoredTools: [],
  warnings: [],
};

describe("the Connect sheet's live result line", () => {
  const url = "https://mcp.example.com/my/research";
  it("loading: a skeleton and a tilde, never 0", () => {
    const out = text(render(<ResultLine url={url} preview={undefined} pending error={null} onRetry={() => undefined} />));
    expect(out).toContain("Your agent will see");
    expect(out).toContain("(~ tokens)");
    expect(out).not.toMatch(/\b0 tools\b/);
  });

  it("loaded: the count and the token estimate, with the tools behind it", () => {
    const out = text(render(<ResultLine url={url} preview={PREVIEW} pending={false} error={null} onRetry={() => undefined} />));
    expect(out).toContain("Your agent will see 1 tool (~920 tokens).");
    expect(out).toContain("get_weather");
    expect(out).toContain("up to $0.002 · 3 providers");
  });

  it("failed: Couldn't load the tool list, Retry, and Copy still works", () => {
    const out = text(render(<ResultLine url={url} preview={undefined} pending={false} error={new Error("x")} onRetry={() => undefined} />));
    expect(out).toContain("Couldn't load the tool list");
    expect(out).toContain("Retry");
    expect(out).toContain("Copy still works.");
  });

  it("the URL wraps (break-all) for a phone", () => {
    expect(render(<ResultLine url={url} preview={PREVIEW} pending={false} error={null} onRetry={() => undefined} />)).toContain("break-all");
  });
});

const SERVERS: ServersInUseData = {
  overBudget: true,
  servers: [
    {
      canonicalUrl: "https://mcp.example.com/my/research",
      endpointKind: "TOOLSET",
      toolsetId: "s1",
      name: "Research kit",
      serverName: "research",
      client: "claude-code",
      toolCount: 22,
      estimatedTokens: 5_100,
      discovery: "FULL",
      lastCallAt: "2026-10-17T13:50:00.000Z",
      handedOutAt: "2026-10-14T09:00:00.000Z",
      firstCallAt: "2026-10-14T09:02:00.000Z",
      waitingForFirstCall: false,
      available: true,
      updateAvailable: false,
    },
    {
      canonicalUrl: "https://mcp.example.com/?tools=geocode_place,get_weather",
      endpointKind: "ROOT",
      toolsetId: null,
      name: "weather",
      serverName: "weather",
      client: "cursor",
      toolCount: 6,
      estimatedTokens: 1_300,
      discovery: "FULL",
      lastCallAt: null,
      handedOutAt: "2026-10-17T13:58:00.000Z",
      firstCallAt: null,
      waitingForFirstCall: true,
      available: true,
      updateAvailable: false,
    },
  ],
};

describe("Servers in use", () => {
  it("one row per URL — name, tools, tokens, last call — a waiting row, and the over-budget warning", () => {
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), SERVERS)));
    expect(out).toContain("Name Tools Tokens (est.) Last call Change");
    expect(out).toContain("Read-only: to change one, make a new URL");
    expect(out).toContain("Research kit");
    expect(out).toContain("22");
    expect(out).toContain("~5.1k");
    expect(out).toContain("Waiting for the first call");
    // T2: only servers that show every tool count; without a search URL the fix is "Narrow".
    expect(out).toContain("The servers that show every tool show 28 between them, more than 25.");
    expect(out).toContain("The biggest is “Research kit” (in your app: research), with 22 tools.");
    expect(out).toContain("Narrow it");
    expect(out).toContain("2 chosen tools");
    expect(out).toContain("In your app: “weather”");
    expect(out).toContain("Connect research-bot");
  });

  it("the warning's count is the rows' own sum: no warning at 25 or fewer", () => {
    const fits = { overBudget: true, servers: [{ ...SERVERS.servers[0]!, toolCount: 13 }, SERVERS.servers[1]!] };
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), fits)));
    expect(out).not.toContain("more than 25");
  });

  it("phone: stacked cards with a full-width Change, the table only from tablet up", () => {
    const html = render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), SERVERS));
    expect(html).toContain('data-testid="server-cards"');
    expect(html).toMatch(/class="[^"]*tablet:hidden[^"]*" data-testid="server-cards"/);
    expect(html).toMatch(/class="hidden w-full rounded-lg border border-01 tablet:block"/);
    expect(html).not.toContain("min-w-[520px]");
    expect(text(html)).toContain("Change makes a new URL for a server");
    expect(text(html)).toContain("Change…");
  });

  it("two servers with one name in the app: says they clash", () => {
    const dup = { overBudget: false, servers: [SERVERS.servers[0]!, { ...SERVERS.servers[1]!, serverName: "research" }] };
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), dup)));
    expect(out).toContain("another server here has this name too");
  });

  it("empty: says so and offers Connect", () => {
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), { servers: [], overBudget: false })));
    expect(out).toContain("No server yet: connect research-bot to choose what it uses.");
    expect(out).toContain("Connect research-bot");
  });

  it("empty after calls: says they came through Everything, never \"not connected\"", () => {
    const recent = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const out = text(
      render(<ServersInUse agentId="a1" agentName="research-bot" lastCallAt={recent} />, (c) =>
        c.setQueryData(toolsetKeys.servers("a1"), { servers: [], overBudget: false }),
      ),
    );
    expect(out).toContain("Calls without one reach Everything: every tool it may use");
    expect(out).not.toContain("No server yet");
  });

  it("a server that no longer serves says so instead of a count", () => {
    const gone = { overBudget: false, servers: [{ ...SERVERS.servers[0]!, available: false, toolCount: null, estimatedTokens: null }] };
    const out = text(render(<ServersInUse agentId="a1" agentName="research-bot" />, (c) => c.setQueryData(toolsetKeys.servers("a1"), gone)));
    expect(out).toContain("No longer serves");
  });
});

describe("the client tabs", () => {
  it("has the ten clients, Claude Code first with the pinned proxy install and no key", () => {
    const html = render(<McpConfigTabs token="assay_sk_live_full_key" url="https://mcp.example.com/" />);
    const out = text(html);
    expect(out).toContain("Claude Code Codex CLI Cursor VS Code Windsurf Gemini CLI Claude Desktop claude.ai ChatGPT My own code");
    // Phone: the tab row wraps rather than clipping the last tab.
    expect(html).toContain("flex-wrap");
    expect(out).toContain("claude mcp add --scope user assay -- npx -y @assay-ai/mcp@1.2.3 --name assay");
    expect(out).not.toContain("assay_sk_live_full_key");
    expect(out).not.toContain("mcp-remote");
  });

  it("My own code, without the key, names it by its prefix", () => {
    const out = text(render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url="https://mcp.example.com/" client="other" />));
    expect(out).toContain("assay_sk_live_ab12…REST_OF_YOUR_KEY");
  });

  it("snippets wrap on a phone, so the URL and the header stay visible (review F, 390px)", () => {
    const html = render(<McpConfigTabs token="k" url="https://mcp.example.com/" />);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-all");
    expect(html).not.toContain("overflow-x-auto");
  });
});
