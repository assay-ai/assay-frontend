import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { AgentAccess, McpUrlPreview, RefusedCall, ServersInUse, Toolset } from "@/services/toolsets.service";

import { parseConnectVariant } from "./demo-connect";
import { DEMO_FIXTURES } from "./fixtures";
import { demoPreview, resetDemoToolsets, TOOLSET_FIXTURES } from "./fixtures-toolsets";

const PROD = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const STAGING = "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54";
// NEXT_PUBLIC_MCP_URL is not set in tests: the snippet's placeholder host.
const HOST = "https://<your-mcp-host>";

function call<T>(method: string, path: string, data?: Record<string, unknown>, query: Record<string, unknown> = {}): T {
  const fixture = TOOLSET_FIXTURES.find(
    (f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  if (!fixture) throw new Error(`no fixture for ${method} ${path}`);
  return fixture.body(path, query, data) as T;
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

describe("demo fixtures: tool sets, access, Connect preview, servers, refused calls", () => {
  it("are registered with the demo data layer, every new endpoint", () => {
    const routes = TOOLSET_FIXTURES.map((f) => `${f.method} ${String(f.match)}`);
    expect(routes).toHaveLength(31);
    for (const fixture of TOOLSET_FIXTURES) expect(DEMO_FIXTURES).toContain(fixture);
  });

  it("list two tool sets, each served at /my/{slug}", () => {
    const page = call<{ items: Toolset[] }>("GET", "/toolsets");
    expect(page.items.map((t) => [t.name, t.mcpUrl, t.toolCount])).toEqual([
      ["Research kit", `${HOST}/my/research`, 4],
      ["Weather and places", `${HOST}/my/weather`, 2],
    ]);
  });

  it("derive the combined result per tool from the catalogue and the agent's limits", () => {
    const access = call<AgentAccess>("GET", `/agents/${PROD}/access`);
    expect(access.accessMode).toBe("RESTRICTED");
    expect(access.rules.maxPrice).toMatchObject({ amount: "5000", decimals: 6 });
    // get_weather: three providers, one excluded by the agent → 2 of 3.
    expect(access.tools.find((t) => t.name === "get_weather")).toMatchObject({ access: "ALLOWED", providersTotal: 3, providersLeft: 2 });
    // search_web is allowed only through the Research kit's own URL.
    expect(access.tools.find((t) => t.name === "search_web")?.access).toBe("VIA_TOOLSET_URL");
    expect(access.tools.find((t) => t.name === "get_token_market")?.access).toBe("BLOCKED");
    expect(call<AgentAccess>("GET", `/agents/${STAGING}/access`).accessMode).toBe("ALL");
  });

  it("preview Everything for a restricted agent: blocked tools and a fix", () => {
    const preview = demoPreview(`${HOST}/`, PROD);
    expect(preview.endpointKind).toBe("ROOT");
    expect(preview.listedCount).toBeGreaterThan(0);
    expect(preview.estimatedTokens).toBeGreaterThan(0);
    expect(preview.warnings.map((w) => w.code)).toContain("BLOCKED_BY_ACCESS");
  });

  it("preview a tool set: its rules and the agent's limits leave no provider for search_web", () => {
    const preview = call<McpUrlPreview>("POST", "/mcp-urls/preview", { url: `${HOST}/my/research`, agentId: PROD });
    expect(preview.toolsetName).toBe("Research kit");
    const search = preview.tools.find((t) => t.name === "search_web")!;
    expect(search).toMatchObject({ allowed: true, noProviderFits: true, noFitReason: "RULES", price: null });
    expect(preview.warnings.find((w) => w.code === "NO_PROVIDER_FITS")?.tools).toContainEqual({ toolId: search.toolId, name: "search_web" });
  });

  it("preview only these tools, free only, and an unknown name", () => {
    const preview = demoPreview(`${HOST}/?tools=get_weather,nope_tool`, STAGING);
    expect(preview.ignoredTools).toEqual(["nope_tool"]);
    expect(preview.tools.map((t) => t.name)).toEqual(["get_weather"]);
    const free = demoPreview(`${HOST}/?free=1`, STAGING);
    expect(free.freeOnly).toBe(true);
    expect(free.tools.every((t) => t.pricingMode === "FREE" || t.pricingMode === "FREEMIUM")).toBe(true);
  });

  it("answer an unknown tool set with MCP_URL_NOT_FOUND and another host with URL_NOT_RECOGNISED", () => {
    expect(() => demoPreview(`${HOST}/my/missing`, PROD)).toThrow(ApiError);
    try {
      demoPreview("https://elsewhere.example.com/", PROD);
    } catch (error) {
      expect((error as ApiError).code).toBe("URL_NOT_RECOGNISED");
    }
  });

  it("list servers in use, and staging's URL waiting for its first call", () => {
    const prod = call<ServersInUse>("GET", `/agents/${PROD}/servers`);
    expect(prod.servers.map((s) => s.name)).toEqual(["Research kit", "weather"]);
    expect(prod.overBudget).toBe(false);
    const staging = call<ServersInUse>("GET", `/agents/${STAGING}/servers`);
    expect(staging.servers[0]).toMatchObject({ waitingForFirstCall: true, lastCallAt: null });
  });

  it("record a handed-out URL in its canonical form", () => {
    const row = call<ServersInUse["servers"][number]>("POST", `/agents/${PROD}/connect-urls`, {
      url: `${HOST}/?tools=get_weather,geocode_place&free=1`,
      serverName: "tools",
      client: "cursor",
    });
    expect(row.canonicalUrl).toBe(`${HOST}/?tools=geocode_place,get_weather&free=1`);
    expect(row.waitingForFirstCall).toBe(true);
    expect(call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers[0]!.canonicalUrl).toBe(row.canonicalUrl);
  });

  it("refused calls carry every shape the view draws, and open by id", () => {
    const page = call<{ items: RefusedCall[] }>("GET", "/refused-calls", undefined, { agentId: PROD });
    // Newest first; the get_weather rows are the T3 contract refusals (fixtures-refusals-contracts).
    expect(page.items.filter((c) => c.toolName !== "get_weather").map((c) => c.refusalCode)).toEqual(["NO_PROVIDER_MATCHES_RULES", "NO_PROVIDER_MATCHES_RULES", "TOOL_NOT_ALLOWED", "TOOL_NOT_IN_TOOLSET"]);
    expect(page.items.map((c) => Date.parse(c.createdAt))).toEqual(page.items.map((c) => Date.parse(c.createdAt)).sort((a, b) => b - a));
    expect(page.items.every((c) => c.charged === false)).toBe(true);
    const single = page.items.find((c) => c.toolName === "Market quote")!;
    expect(single.providers).toHaveLength(1);
    expect(single.providers[0]!.providerName).toBe("Harborlight Data Ltd");
    expect(call<RefusedCall>("GET", `/refused-calls/${single.callId}`).callId).toBe(single.callId);
    expect(() => call("GET", "/refused-calls/nope")).toThrow(ApiError);
  });

  it("answer a change to access, and keep it for the page's life", () => {
    const next = call<AgentAccess>("PATCH", `/agents/${PROD}/access`, { rules: { excludeProviderIds: [] }, changeReason: "x" });
    expect(next.rules.excludeProviderIds).toEqual([]);
    expect(next.tools.find((t) => t.name === "get_weather")?.providersLeft).toBe(3);
    expect(call<AgentAccess>("GET", `/agents/${PROD}/access`).rules.excludeProviderIds).toEqual([]);
    const connected = call<AgentAccess & { everything: boolean }>("POST", `/agents/${PROD}/access/only-connected`);
    expect(connected.everything).toBe(false);
    expect(connected.allowedToolsets.map((t) => t.name)).toEqual(["Research kit"]);
  });

  it("create, edit, rename and delete a tool set; a taken slug answers 409 with a suggestion", () => {
    const created = call<Toolset>("POST", "/toolsets", { name: "Market watch" });
    expect(created.slug).toBe("market-watch");
    try {
      call("POST", "/toolsets", { name: "Research" });
    } catch (error) {
      expect((error as ApiError).code).toBe("TOOLSET_SLUG_TAKEN");
      expect((error as ApiError).context?.suggestion).toBe("research-2");
    }
    const tool = call<AgentAccess>("GET", `/agents/${PROD}/access`).tools[0]!;
    const edited = call<Toolset>("PUT", `/toolsets/${created.id}/entries`, {
      entries: [{ toolId: tool.toolId, providerMode: "BEST", providerIds: [], minTier: null, maxPrice: null, minQuality: null, onEmpty: "FAIL" }],
    });
    expect(edited.entries).toHaveLength(1);
    expect(call<Toolset>("PATCH", `/toolsets/${created.id}`, { name: "Markets" }).name).toBe("Markets");
    expect(call("DELETE", `/toolsets/${created.id}`)).toBeNull();
    expect(() => call("GET", `/toolsets/${created.id}`)).toThrow(ApiError);
  });
});

describe("the demo account's agents", () => {
  it("has two agents (Explore's agent picker) and a live key on prod (the Connect key row)", () => {
    const get = (path: string) => {
      const f = DEMO_FIXTURES.find((x) => x.method === "GET" && (x.match instanceof RegExp ? x.match.test(path) : x.match === path))!;
      return f.body(path, {}) as { items: { agentId?: string; label?: string; revokedAt?: string | null }[] };
    };
    expect(get("/agents").items.map((a) => a.label)).toEqual(["prod", "staging"]);
    expect(get(`/agents/${PROD}/credentials`).items.some((k) => !k.revokedAt)).toBe(true);
  });
});

describe("the ?connect= demo switch", () => {
  it("parses the documented pictures only", () => {
    for (const v of ["default", "all", "nothing", "waiting", "over-budget", "single", "preview-error", "empty", "shared", "unlisted", "update-available", "delisted", "stopped", "removed", "handle-taken", "claim-refused"]) {
      expect(parseConnectVariant(v)).toBe(v);
    }
    expect(parseConnectVariant("bogus")).toBeNull();
  });

  it("nothing: every preview says so", () => {
    asVariant("nothing");
    expect(demoPreview(`${HOST}/`, PROD).warnings.map((w) => w.code)).toContain("NOTHING_ALLOWED");
  });

  it("waiting: the root URL handed out by the first run waits for its first call", () => {
    asVariant("waiting");
    const waiting = call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers.find((s) => s.waitingForFirstCall);
    expect(waiting?.canonicalUrl).toBe(`${HOST}/`);
  });

  it("over budget: the rows really add up to more than 25, and the flag agrees", () => {
    asVariant("over-budget");
    const servers = call<ServersInUse>("GET", `/agents/${PROD}/servers`);
    const sum = servers.servers.reduce((n, s) => n + (s.toolCount ?? 0), 0);
    expect(sum).toBeGreaterThan(25);
    expect(servers.overBudget).toBe(true);
    expect(call<ServersInUse>("GET", `/agents/${STAGING}/servers`).overBudget).toBe(false);
  });

  it("a provider tool goes in ?tools= by its id, never by its display name", () => {
    const preview = demoPreview(`${HOST}/?tools=market-quote`, STAGING);
    expect(preview.tools.map((t) => t.name)).toEqual(["Market quote"]);
    expect(preview.ignoredTools).toEqual([]);
  });

  it("single, preview-error and empty", () => {
    asVariant("single");
    expect(call<{ items: RefusedCall[] }>("GET", "/refused-calls").items.map((c) => c.toolName)).toEqual(["Market quote"]);
    asVariant("preview-error");
    expect(() => demoPreview(`${HOST}/`, PROD)).toThrow(ApiError);
    asVariant("empty");
    expect(call<{ items: Toolset[] }>("GET", "/toolsets").items).toEqual([]);
    expect(call<ServersInUse>("GET", `/agents/${PROD}/servers`).servers).toEqual([]);
    expect(call<{ items: RefusedCall[] }>("GET", "/refused-calls").items).toEqual([]);
  });
});
