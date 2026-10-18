import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { PublicHandleProfile, PublicToolsetList, PublicToolsetPage } from "@/services/public-toolsets.service";
import type { AgentAccess, CopyResult, OrgHandle, PublishResult, ServersInUse, Toolset, ToolsetOwnStats, ToolsetVersion, ToolsetVersionSummary } from "@/services/toolsets.service";

import { DEMO_FIXTURES } from "./fixtures";
import { DEMO_PUBLIC_SETS } from "./fixtures-public-toolsets";
import { demoPreview, demoToolsetNotifications, resetDemoToolsets, TOOLSET_FIXTURES } from "./fixtures-toolsets";

const PROD = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const RESEARCH = "5f0c9b2e-7d41-4a83-b6e2-1c9a8d3f7e05";
const WEATHER = "a83e6d14-2f5b-4c97-8e0a-6b1d4c2f9a37";
const HOST = "https://<your-mcp-host>";

function call<T>(method: string, path: string, data?: Record<string, unknown>, query: Record<string, unknown> = {}): T {
  const fixture = TOOLSET_FIXTURES.find((f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path));
  if (!fixture) throw new Error(`no fixture for ${method} ${path}`);
  return fixture.body(path, query, data) as T;
}

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function asVariant(variant: string) {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search: `?connect=${variant}` },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MCP_URL", "");
  resetDemoToolsets();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("demo fixtures: the public catalogue", () => {
  it("seeds the three Official sets, and community sets on both sides of k = 5", () => {
    const list = call<PublicToolsetList>("GET", "/public/toolsets", undefined, { publisher: "official" });
    expect(list.toolsets.map((c) => `@${c.handle}/${c.slug}`).sort()).toEqual(["@assay/crypto-research", "@assay/weather-and-places", "@assay/web-research"]);
    expect(list.toolsets.every((c) => c.mcpUrls.recommended === c.mcpUrls.latest)).toBe(true);
    const community = call<PublicToolsetList>("GET", "/public/toolsets", undefined, { publisher: "community" }).toolsets;
    expect(community.some((c) => c.activeUsers?.value === null && c.activeUsers.display === "Fewer than 5")).toBe(true);
    expect(community.some((c) => (c.activeUsers?.value ?? 0) >= 5)).toBe(true);
    // Everyone else's is handed out pinned.
    expect(community.every((c) => c.mcpUrls.recommended === `${c.mcpUrls.latest}@${c.version}`)).toBe(true);
    // Link-only sets are never listed.
    expect(call<PublicToolsetList>("GET", "/public/toolsets").toolsets.some((c) => c.slug === "desk-tools")).toBe(false);
  });

  it("filters by search, topic and order", () => {
    expect(call<PublicToolsetList>("GET", "/public/toolsets", undefined, { q: "travel" }).toolsets.map((c) => c.slug)).toEqual(["travel-planner"]);
    expect(call<PublicToolsetList>("GET", "/public/toolsets", undefined, { category: "finance" }).toolsets.every((c) => c.category === "finance")).toBe(true);
    const newest = call<PublicToolsetList>("GET", "/public/toolsets", undefined, { sort: "new" }).toolsets[0]!;
    expect(newest.slug).toBe("travel-planner");
    expect(call<PublicToolsetList>("GET", "/public/toolsets", undefined, { sort: "popular" }).toolsets[0]!.slug).toBe("web-research");
  });

  it("serves a page, its versions, a link-only page by token, a public name and the topics", () => {
    const page = call<PublicToolsetPage>("GET", "/public/toolsets/@marketkit/crypto-research");
    expect(page).toMatchObject({ version: 3, badge: "COMMUNITY", stats: { activeUsers: { value: 35 } } });
    expect(call<{ versions: unknown[] }>("GET", "/public/toolsets/@marketkit/crypto-research/versions").versions).toHaveLength(3);
    const link = call<PublicToolsetPage>("POST", "/public/toolsets/by-token", { token: "h3j8d2k9s6a1f4g7l0q5wz" });
    expect(link.mcpUrls.pinned).toBe(`${HOST}/u/h3j8d2k9s6a1f4g7l0q5wz@2`);
    expect(refusal(() => call("POST", "/public/toolsets/by-token", { token: "zzzzzzzzzzzzzzzzzzzzzz" })).status).toBe(404);
    expect(call<PublicHandleProfile>("GET", "/public/handles/assay").toolsets).toHaveLength(3);
    expect(refusal(() => call("GET", "/public/handles/nobody-here")).code).toBe("TOOLSET_HANDLE_NOT_FOUND");
    expect(call<{ categories: { category: string }[] }>("GET", "/public/categories").categories.map((c) => c.category)).toContain("weather");
    // The cards' tool ids join the public catalogue, except one maker's own link-only tool.
    expect(DEMO_PUBLIC_SETS.find((s) => s.slug === "desk-tools")!.extraIds).toBeTruthy();
  });
});

describe("demo fixtures: sharing a tool set", () => {
  it("default: no public name yet, so sharing asks for one; v1 for the team works without", () => {
    expect(call<OrgHandle>("GET", "/org/handle")).toMatchObject({ handle: null, canChange: true });
    expect(refusal(() => call("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "UNLISTED" })).code).toBe("TOOLSET_HANDLE_REQUIRED");
    const saved = call<PublishResult>("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "PRIVATE" });
    expect(saved.version).toMatchObject({ version: 1, changelog: "First version: 4 tools: search_web, extract_page_text, search_wikipedia and summarize_document." });
    expect(saved.toolset.urls?.myPinned).toBe(`${HOST}/my/research@1`);
  });

  it("claims a name, shares by link, lists it, rotates the link and stops sharing", () => {
    expect(refusal(() => call("PUT", "/org/handle", { handle: "x" })).context).toEqual({ reason: "FORMAT" });
    expect(refusal(() => call("PUT", "/org/handle", { handle: "support" })).context).toEqual({ reason: "RESERVED" });
    expect(refusal(() => call("PUT", "/org/handle", { handle: "marketkit" })).code).toBe("TOOLSET_HANDLE_TAKEN");
    expect(call<OrgHandle>("PUT", "/org/handle", { handle: "brightpath" }).handle).toBe("brightpath");
    const linked = call<PublishResult>("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "UNLISTED", changelog: "First shared." });
    expect(linked.toolset.visibility).toBe("UNLISTED");
    expect(linked.toolset.urls?.unlistedPinned).toMatch(/\/u\/[a-z0-9]{22}@1$/);
    expect(linked.version?.changelog).toBe("First shared.");
    const listed = call<PublishResult>("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "PUBLIC" });
    expect(listed.toolset.urls?.publicPinned).toBe(`${HOST}/@brightpath/research@2`);
    expect(call<PublicToolsetList>("GET", "/public/toolsets", undefined, { q: "research kit" }).toolsets.map((c) => c.handle)).toContain("brightpath");
    const before = linked.toolset.unlistedToken;
    expect(call<PublishResult>("POST", `/toolsets/${RESEARCH}/unlisted-token/rotate`).toolset.unlistedToken).not.toBe(before);
    const stopped = call<PublishResult>("POST", `/toolsets/${RESEARCH}/unpublish`);
    expect(stopped.toolset).toMatchObject({ visibility: "PRIVATE" });
    expect(stopped.toolset.sharingEndsAt).toBeTruthy();
    expect(call<OrgHandle>("GET", "/org/handle").canChange).toBe(false);
  });

  it("shared: v3 listed, the Draft one change ahead, versions and their snapshots", () => {
    asVariant("shared");
    const set = call<Toolset>("GET", `/toolsets/${RESEARCH}`);
    expect(set).toMatchObject({ visibility: "PUBLIC", latestVersion: 3, handle: "brightpath", listingStatus: "LISTED" });
    expect(call<ToolsetVersionSummary[]>("GET", `/toolsets/${RESEARCH}/versions`).map((v) => v.version)).toEqual([3, 2, 1]);
    const v3 = call<ToolsetVersion>("GET", `/toolsets/${RESEARCH}/versions/3`);
    expect(v3.entries.find((e) => e.toolName === "summarize_document")?.onEmpty).toBe("FAIL");
    expect(refusal(() => call("GET", `/toolsets/${RESEARCH}/versions/9`)).code).toBe("TOOLSET_VERSION_NOT_FOUND");
    expect(call<Toolset>("GET", `/toolsets/${WEATHER}`).visibility).toBe("UNLISTED");
    const next = call<PublishResult>("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "PUBLIC" });
    expect(next.diff).toEqual({ added: [], removed: [], rulesChanged: ["summarize_document"], settingsChanged: [] });
    expect(next.version?.changelog).toBe("Changed provider rules for summarize_document.");
  });

  it("publisher stats: above k when listed, withheld below k when only linked, nothing before sharing", () => {
    asVariant("shared");
    const listed = call<ToolsetOwnStats>("GET", `/toolsets/${RESEARCH}/stats`);
    expect(listed.figures?.activeUsers).toEqual({ value: 25, display: "25" });
    expect(listed.dashboard?.tools.some((t) => t.withheld && t.calls?.display === "Fewer than 5 orgs")).toBe(true);
    const linked = call<ToolsetOwnStats>("GET", `/toolsets/${WEATHER}/stats`);
    expect(linked.figures).toMatchObject({ activeUsers: { value: null, display: "Fewer than 5" }, calls30d: null });
    resetDemoToolsets();
    asVariant("default");
    expect(call<ToolsetOwnStats>("GET", `/toolsets/${RESEARCH}/stats`)).toEqual({ weekStart: null, figures: null, dashboard: null });
  });

  it("delisted, stopped and removed paint their states", () => {
    asVariant("delisted");
    expect(call<Toolset>("GET", `/toolsets/${RESEARCH}`)).toMatchObject({ delisted: true, listingStatus: "DELISTED" });
    asVariant("stopped");
    expect(call<Toolset>("GET", `/toolsets/${RESEARCH}`)).toMatchObject({ visibility: "PRIVATE" });
    expect(call<Toolset>("GET", `/toolsets/${RESEARCH}`).sharingEndsAt).toBeTruthy();
    expect(call<PublicToolsetPage>("POST", "/public/toolsets/by-token", { token: "r8m2x5k9q1w4z7n3p6t0ab" }).sharingEndsAt).toBeTruthy();
    asVariant("removed");
    expect(call<Toolset>("GET", `/toolsets/${RESEARCH}`).removed).toBe(true);
    expect(refusal(() => call("POST", `/toolsets/${RESEARCH}/publish`, { visibility: "PUBLIC" })).context).toEqual({ refusal: "TAKEN_DOWN" });
  });

  it("handle-taken suggests free names that then work; claim-refused asks for funds", () => {
    asVariant("handle-taken");
    const taken = refusal(() => call("PUT", "/org/handle", { handle: "acme" }));
    expect(taken.code).toBe("TOOLSET_HANDLE_TAKEN");
    expect(taken.context?.suggestions).toEqual(["acme-hq", "acme-labs", "acme2"]);
    expect(call<OrgHandle>("PUT", "/org/handle", { handle: "acme-hq" }).handle).toBe("acme-hq");
    asVariant("claim-refused");
    expect(refusal(() => call("PUT", "/org/handle", { handle: "acme" })).context).toEqual({ reason: "NOT_VERIFIED" });
  });
});

describe("demo fixtures: copies, reports, discovery and updates", () => {
  it("makes my own version, leaving out link-only and removed tools with the reason", () => {
    const desk = DEMO_PUBLIC_SETS.find((s) => s.slug === "desk-tools")!;
    expect(refusal(() => call("POST", `/toolsets/${desk.id}/copy`, {})).status).toBe(404);
    const copy = call<CopyResult>("POST", `/toolsets/${desk.id}/copy`, { unlistedToken: desk.unlistedToken, version: 2 });
    expect(copy.excluded).toEqual([{ toolId: desk.extraIds!.cobalt__news_search, toolName: "cobalt__news_search", reason: "LINK_ONLY" }]);
    expect(copy.toolset).toMatchObject({ visibility: "PRIVATE", toolCount: 2, forkedFrom: { toolsetId: desk.id, version: 2 } });
    const news = DEMO_PUBLIC_SETS.find((s) => s.slug === "news-digest")!;
    expect(call<CopyResult>("POST", `/toolsets/${news.id}/copy`, {}).excluded.map((e) => e.reason)).toEqual(["REMOVED"]);
  });

  it("takes one open report per item", () => {
    expect(call<{ id: string }>("POST", "/reports", { handle: "quill", reason: "Spam" }).id).toBeTruthy();
    expect(refusal(() => call("POST", "/reports", { handle: "quill", reason: "Spam" })).code).toBe("TOOLSET_REPORT_DUPLICATE");
  });

  it("previews the root in search mode, /c/ topics, and shared sets; Always loaded rides along", () => {
    const root = demoPreview(`${HOST}/`, PROD);
    expect(root).toMatchObject({ discovery: "SEARCH", listedTools: ["search_tools", "get_tool", "call_tool"], listedCount: 3 });
    // "prod" may use three tools directly; "staging" may use everything.
    expect(root.reachableCount).toBe(3);
    expect(demoPreview(`${HOST}/`, "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54").reachableCount).toBeGreaterThan(10);
    expect(demoPreview(`${HOST}/?discovery=full`, PROD).discovery).toBe("FULL");
    const topic = demoPreview(`${HOST}/c/weather`, PROD);
    expect(topic.endpointKind).toBe("CATEGORY");
    expect(topic.tools.map((t) => t.name).sort()).toEqual(["geocode_place", "get_weather"]);
    expect(demoPreview(`${HOST}/@assay/web-research`, PROD).toolsetName).toBe("Web research");
    expect(() => demoPreview(`${HOST}/@assay/web-research@9`, PROD)).toThrow(ApiError);
    call<AgentAccess>("PATCH", `/agents/${PROD}/access`, { pinnedTools: ["get_weather"] });
    expect(demoPreview(`${HOST}/`, PROD).listedTools).toEqual(["get_weather", "search_tools", "get_tool", "call_tool"]);
    expect(refusal(() => call("PATCH", `/agents/${PROD}/access`, { pinnedTools: ["a", "b", "c", "d", "e", "f"] })).status).toBe(429);
  });

  it("over-budget counts only servers that show every tool, and offers their search URL", () => {
    asVariant("over-budget");
    const { servers, overBudget } = call<ServersInUse>("GET", `/agents/${PROD}/servers`);
    expect(overBudget).toBe(true);
    const everything = servers.find((s) => s.canonicalUrl === `${HOST}/?discovery=full`)!;
    expect(everything).toMatchObject({ discovery: "FULL", searchUrl: `${HOST}/` });
    const shown = servers.filter((s) => s.discovery === "FULL").reduce((n, s) => n + (s.toolCount ?? 0), 0);
    expect(shown).toBeGreaterThan(25);
  });

  it("update-available: the server chip, the access lock, and the alert", () => {
    asVariant("update-available");
    const row = call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers.find((s) => s.canonicalUrl === `${HOST}/@marketkit/crypto-research@2`)!;
    expect(row).toMatchObject({ updateAvailable: true, name: "Crypto research desk" });
    const entry = call<AgentAccess>("GET", `/agents/${PROD}/access`).allowedToolsets.find((t) => !t.own)!;
    expect(entry).toMatchObject({ version: 2, latestVersion: 3, handle: "marketkit", status: "ACTIVE" });
    expect(refusal(() => call("PATCH", `/agents/${PROD}/access`, { allowedToolsets: [{ toolsetId: entry.toolsetId, version: null, viaUrlOnly: true }] })).code).toBe(
      "TOOLSET_ACCESS_INVALID",
    );
    const moved = call<AgentAccess>("PATCH", `/agents/${PROD}/access`, { allowedToolsets: [{ toolsetId: entry.toolsetId, version: 3, viaUrlOnly: true }] });
    expect(moved.allowedToolsets[0]).toMatchObject({ version: 3, latestVersion: 3 });
    const [notice] = demoToolsetNotifications() as { event: string; payload: { fromVersion: number; toVersion: number } }[];
    expect(notice).toMatchObject({ event: "toolset.update_available", payload: { fromVersion: 2, toVersion: 3 } });
    const feed = DEMO_FIXTURES.find((f) => f.method === "GET" && f.match === "/notifications")!.body("/notifications", {}) as { items: { event: string }[] };
    expect(feed.items[0]!.event).toBe("toolset.update_available");
  });
});

describe("demo fixtures: the review-fix contracts", () => {
  it("serves one version with its diff, and a link-only page with its diff", () => {
    const detail = call<{ diff: { added: string[]; rulesChanged: string[] }; entries: { notReviewed: boolean }[] }>(
      "GET",
      "/public/toolsets/@marketkit/crypto-research/versions/3",
      undefined,
      { diffFrom: 2 },
    );
    expect(detail.diff).toMatchObject({ added: ["get_usd_eur_rate"], rulesChanged: ["get_token_market"] });
    expect(refusal(() => call("GET", "/public/toolsets/@marketkit/crypto-research/versions/9")).status).toBe(404);
    const link = call<PublicToolsetPage>("POST", "/public/toolsets/by-token", { token: "h3j8d2k9s6a1f4g7l0q5wz", v: 2, diffFrom: 1 });
    expect(link.diff?.added).toEqual(["cobalt__news_search"]);
    expect(link.entries.find((e) => e.toolName === "cobalt__news_search")?.notReviewed).toBe(true);
    expect(link).toMatchObject({ notReviewed: true, routesToPublisher: false });
    expect(call<PublicToolsetPage>("GET", "/public/toolsets/@cobalt/fast-search").routesToPublisher).toBe(true);
  });

  it("a server locked to an older version carries the newest version and its URL", () => {
    asVariant("update-available");
    const row = call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers.find((s) => s.updateAvailable)!;
    expect(row).toMatchObject({ latestVersion: 3, latestUrl: `${HOST}/@marketkit/crypto-research@3` });
    expect(call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers.filter((s) => !s.updateAvailable).every((s) => !s.latestUrl)).toBe(true);
  });

  it("delisted, stopped and removed each show another team's locked set in that state", () => {
    for (const [variant, status] of [["delisted", "DELETED"], ["stopped", "NOT_SHARED"], ["removed", "REMOVED"]] as const) {
      resetDemoToolsets();
      asVariant(variant);
      const entry = call<AgentAccess>("GET", `/agents/${PROD}/access`).allowedToolsets.find((t) => t.own === false);
      expect(entry).toMatchObject({ status, version: 1, latestVersion: null });
    }
  });
});

describe("demo fixtures: retest cases", () => {
  it("the bell has a tool set update in the default picture, and staging uses a working link-only set", () => {
    expect((demoToolsetNotifications() as { event: string }[])[0]?.event).toBe("toolset.update_available");
    const staging = call<ServersInUse>("GET", "/agents/b71e05a3-2c48-4d90-9f61-38ca7d0b2e54/servers").servers;
    const desk = staging.find((s) => s.serverName === "desk")!;
    expect(desk).toMatchObject({ updateAvailable: true, latestVersion: 2, name: "Desk tools" });
    const page = call<PublicToolsetPage>("POST", "/public/toolsets/by-token", { token: "h3j8d2k9s6a1f4g7l0q5wz" });
    expect(page.entries.find((e) => e.notReviewed)?.toolName).toBe("cobalt__news_search");
  });

  it("a rule change between versions shows in the entries", () => {
    const v2 = call<{ entries: { toolName: string; providerMode: string }[] }>("GET", "/public/toolsets/@marketkit/crypto-research/versions/2");
    const v3 = call<{ entries: { toolName: string; providerMode: string }[] }>("GET", "/public/toolsets/@marketkit/crypto-research/versions/3");
    expect(v2.entries.find((e) => e.toolName === "get_token_market")?.providerMode).toBe("BEST");
    expect(v3.entries.find((e) => e.toolName === "get_token_market")?.providerMode).toBe("ONLY");
  });
});
