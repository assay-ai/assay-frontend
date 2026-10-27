import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentAccess, AllowedToolset, ServersInUse } from "@/services/toolsets.service";

import { AccessEditor } from "./agent-access-card";
import { readSharedLink } from "./connect-sheet";
import { exclusionReason, expectedExclusions, makerOf } from "./toolset-bits";
import { readUpdateLink } from "./update-sheet";
import { toolsetKeys } from "./use-toolsets";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/" }));

const HOST = "https://mcp.example.com";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("pasting a tool-set link into the Connect sheet", () => {
  it("reads full URLs, bare paths and the web page, with the version", () => {
    expect(readSharedLink(`${HOST}/@assay/crypto-research`, HOST)).toEqual({ pick: { kind: "shared", handle: "assay", slug: "crypto-research" }, version: null });
    expect(readSharedLink("/@marketkit/crypto-research@2", HOST)).toEqual({ pick: { kind: "shared", handle: "marketkit", slug: "crypto-research" }, version: 2 });
    expect(readSharedLink("@marketkit/crypto-research", HOST)?.pick).toEqual({ kind: "shared", handle: "marketkit", slug: "crypto-research" });
    expect(readSharedLink("https://other.example.org/u/h3j8d2k9s6a1f4g7l0q5wz@2", HOST)).toEqual({ pick: { kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz" }, version: 2 });
    expect(readSharedLink("https://app.example.com/toolsets/view#token=h3j8d2k9s6a1f4g7l0q5wz&v=1", HOST)).toEqual({ pick: { kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz" }, version: 1 });
    expect(readSharedLink("/toolsets/view?handle=quill&slug=news-digest", HOST)?.pick).toEqual({ kind: "shared", handle: "quill", slug: "news-digest" });
  });

  it("refuses what is not a tool set", () => {
    expect(readSharedLink("https://mcp.goassay.ai/u/abc123token", HOST)).toBeNull();
    expect(readSharedLink(`${HOST}/`, HOST)).toBeNull();
    expect(readSharedLink("hello", HOST)).toBeNull();
    expect(readSharedLink("", HOST)).toBeNull();
  });
});

describe("the update alert opens in the app", () => {
  it("reads /agents?update=1&from&to#url= into the update sheet's target", () => {
    const url = `${HOST}/@marketkit/crypto-research@3`;
    expect(readUpdateLink("?update=1&from=2&to=3", `#url=${encodeURIComponent(url)}`, HOST)).toEqual({
      choice: { kind: "shared", handle: "marketkit", slug: "crypto-research", version: 2 },
      name: "@marketkit/crypto-research",
      from: 2,
      to: 3,
      toUrl: url,
    });
    expect(readUpdateLink("?update=1&from=3&to=2", `#url=${encodeURIComponent(url)}`, HOST)).toBeNull();
    expect(readUpdateLink("", "", HOST)).toBeNull();
  });

  it("opens nothing for a URL on another host", () => {
    const foreign = "https://evil.example/@assay/web-research@2";
    expect(readUpdateLink("?update=1&from=1&to=2", `#url=${encodeURIComponent(foreign)}`, HOST)).toBeNull();
    expect(readUpdateLink("?update=1&from=1&to=2", `#url=${encodeURIComponent("https://mcp.example.com.evil.example/@assay/web-research@2")}`, HOST)).toBeNull();
  });
});

describe("Make my own version: what stays behind, named by its own maker", () => {
  const entry = { providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL" };
  it("is known before copying", () => {
    const entries = [
      { ...entry, toolId: "a", toolName: "get_token_market", removed: false, notReviewed: false },
      { ...entry, toolId: "b", toolName: "cobalt__news_search", removed: false, notReviewed: true },
      { ...entry, toolId: "c", toolName: "transcribe_audio", removed: true, notReviewed: false },
    ];
    expect(expectedExclusions(entries).map((e) => [e.toolName, e.reason])).toEqual([
      ["cobalt__news_search", "LINK_ONLY"],
      ["transcribe_audio", "REMOVED"],
    ]);
    expect(makerOf("cobalt__news_search")).toBe("cobalt");
    expect(exclusionReason({ toolName: "cobalt__news_search", reason: "LINK_ONLY" })).toBe("is @cobalt's link-only tool: it works only through @cobalt's own link");
  });
});

describe("another team's locked tool sets: every state has a notice and a next step", () => {
  function access(set: Partial<AllowedToolset>): AgentAccess {
    return {
      agentId: "a1",
      scope: "AGENT",
      policyVersion: 1,
      accessMode: "RESTRICTED",
      allowedToolsets: [
        { toolsetId: "ts9", version: 1, viaUrlOnly: true, name: "Travel planner", slug: "travel-planner", deleted: false, handle: "geodesk", own: false, status: "ACTIVE", latestVersion: 1, ...set },
      ],
      allowedToolIds: [],
      rules: { excludeProviderIds: [], maxPrice: null, minTier: null, minQuality: null },
      pinnedTools: [],
      tools: [],
    };
  }
  function render(a: AgentAccess, servers: ServersInUse = { servers: [], overBudget: false }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["catalogue", "providers"], { providers: [] });
    client.setQueryData(["catalogue", "tools"], { tools: [] });
    client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
    client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
    client.setQueryData(["spend-policy"], null);
    client.setQueryData(toolsetKeys.servers("a1"), servers);
    return text(renderToStaticMarkup(<QueryClientProvider client={client}><AccessEditor access={a} agentName="prod" /></QueryClientProvider>));
  }

  it("deleted, stopped and removed say so, with Stop allowing it and where to go next", () => {
    const deleted = render(access({ status: "DELETED", deleted: true, latestVersion: null }));
    expect(deleted).toContain("Deleted by its owner.");
    expect(deleted).toContain("Stop allowing it");
    expect(deleted).toContain("Find another tool set");
    const stopped = render(access({ status: "NOT_SHARED", latestVersion: null }));
    expect(stopped).toContain("Its owner stopped sharing it.");
    expect(stopped).toContain("Make your own version");
    expect(render(access({ status: "REMOVED", latestVersion: null }))).toContain("Removed by Assay after a report. It allows nothing now.");
  });

  it("an update says it, and the app's URL and the agent's lock are told apart", () => {
    const out = render(access({ version: 3, latestVersion: 4 }), {
      overBudget: false,
      servers: [
        {
          canonicalUrl: `https://<your-mcp-host>/@geodesk/travel-planner@2`,
          endpointKind: "TOOLSET",
          toolsetId: "ts9",
          name: "Travel planner",
          serverName: "travel",
          client: null,
          toolCount: 3,
          estimatedTokens: 700,
          discovery: "FULL",
          lastCallAt: null,
          handedOutAt: null,
          firstCallAt: null,
          waitingForFirstCall: false,
          available: true,
          updateAvailable: true,
        },
      ],
    });
    expect(out).toContain("Update available: v4");
    expect(out).toContain("may use v3");
    expect(out).toContain("Your app still connects to v2; this agent may use v3.");
  });
});
