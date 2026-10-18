import { describe, expect, it } from "vitest";

import { KEY_PLACEHOLDER, keyMode, mcpConfig, MCP_CLIENTS } from "@/features/buyer-money/mcp-config";

import {
  buildMcpUrl,
  canonicalTools,
  defaultDiscovery,
  mcpToolName,
  toolDisplay,
  uniqueServerName,
  parseMcpUrl,
  RESERVED_FIRST_SEGMENTS,
  sameChoice,
  suggestServerName,
  webPageOf,
  type ConnectChoice,
} from "./mcp-url";

const HOST = "https://mcp.example.com";

describe("buildMcpUrl — one answer, one URL, in the canonical form", () => {
  it("Everything is the host root", () => {
    expect(buildMcpUrl({ kind: "everything" }, { free: false }, HOST)).toBe("https://mcp.example.com/");
  });

  it("one of my tool sets is /my/{slug}", () => {
    expect(buildMcpUrl({ kind: "toolset", slug: "research" }, { free: false }, HOST)).toBe("https://mcp.example.com/my/research");
  });

  it("only these tools: lowercased, deduplicated, sorted, commas kept as they are", () => {
    expect(buildMcpUrl({ kind: "tools", tools: ["get_weather", "Geocode_place", "get_weather "] }, { free: false }, HOST)).toBe(
      "https://mcp.example.com/?tools=geocode_place,get_weather",
    );
    expect(canonicalTools(["b", "a", "B", ""])).toEqual(["a", "b"]);
  });

  it("Only free tools adds free=1 after tools", () => {
    expect(buildMcpUrl({ kind: "tools", tools: ["a_b"] }, { free: true }, HOST)).toBe("https://mcp.example.com/?tools=a_b&free=1");
    expect(buildMcpUrl({ kind: "everything" }, { free: true }, HOST)).toBe("https://mcp.example.com/?free=1");
    expect(buildMcpUrl({ kind: "toolset", slug: "kit" }, { free: true }, HOST)).toBe("https://mcp.example.com/my/kit?free=1");
  });

  it("an empty tools list is Everything, not `?tools=`", () => {
    expect(buildMcpUrl({ kind: "tools", tools: [] }, { free: false }, HOST)).toBe("https://mcp.example.com/");
  });

  it("keeps another form of the host as it is, adding or dropping free=1 in canonical order", () => {
    const url = "https://mcp.example.com/@acme/kit@3?discovery=full";
    expect(buildMcpUrl({ kind: "url", url }, { free: true }, HOST)).toBe("https://mcp.example.com/@acme/kit@3?free=1&discovery=full");
    expect(buildMcpUrl({ kind: "url", url: `${url}&free=1` }, { free: false }, HOST)).toBe(url);
  });
});

describe("parseMcpUrl — a URL back into the question (Change, browser redirects)", () => {
  it("reads the three T1 answers and the free option", () => {
    expect(parseMcpUrl("https://mcp.example.com/", HOST)).toEqual({ choice: { kind: "everything" }, options: { free: false } });
    expect(parseMcpUrl("https://mcp.example.com", HOST)?.choice).toEqual({ kind: "everything" });
    expect(parseMcpUrl("https://mcp.example.com/my/research", HOST)?.choice).toEqual({ kind: "toolset", slug: "research" });
    expect(parseMcpUrl("https://mcp.example.com/?tools=get_weather,geocode_place&free=1", HOST)).toEqual({
      choice: { kind: "tools", tools: ["geocode_place", "get_weather"] },
      options: { free: true },
    });
  });

  it("round-trips what it builds", () => {
    const choices: ConnectChoice[] = [{ kind: "everything" }, { kind: "toolset", slug: "weather" }, { kind: "tools", tools: ["a_x", "b_y"] }];
    for (const choice of choices) {
      for (const free of [false, true]) {
        const parsed = parseMcpUrl(buildMcpUrl(choice, { free }, HOST), HOST);
        expect(parsed && sameChoice(parsed.choice, choice)).toBe(true);
        expect(parsed?.options.free).toBe(free);
      }
    }
  });

  it("reads an encoded @ and a trailing slash on a tool set", () => {
    expect(parseMcpUrl("https://mcp.example.com/my/research/", HOST)?.choice).toEqual({ kind: "toolset", slug: "research" });
    expect(parseMcpUrl("https://mcp.example.com/%40acme/kit", HOST)?.choice).toEqual({ kind: "shared", handle: "acme", slug: "kit" });
  });

  it("refuses another host, path tricks and bad tool names: 'We couldn't read this URL'", () => {
    expect(parseMcpUrl("https://elsewhere.example.com/", HOST)).toBeNull();
    expect(parseMcpUrl("not a url", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/my/../x", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com//x", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/?tools=Bad Name!", HOST)).toBeNull();
  });

  it("refuses the host's reserved paths, which are not MCP URLs", () => {
    expect(parseMcpUrl("https://mcp.example.com/oauth/authorize", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/.well-known/x", HOST)).toBeNull();
    for (const first of RESERVED_FIRST_SEGMENTS) {
      expect(parseMcpUrl(`https://mcp.example.com/${first}`, HOST)).toBeNull();
      expect(parseMcpUrl(`https://mcp.example.com/${first}/x?free=1`, HOST)).toBeNull();
    }
    expect(RESERVED_FIRST_SEGMENTS).toEqual(["t", ".well-known", "health", "status", "docs", "oauth"]);
  });

  it("works on the unconfigured placeholder host too", () => {
    expect(parseMcpUrl("https://<your-mcp-host>/my/kit", "https://<your-mcp-host>")?.choice).toEqual({ kind: "toolset", slug: "kit" });
  });
});

describe("suggestServerName — at most 9 characters", () => {
  it("names each answer", () => {
    expect(suggestServerName({ kind: "everything" })).toBe("assay");
    expect(suggestServerName({ kind: "toolset", slug: "research" })).toBe("research");
    expect(suggestServerName({ kind: "toolset", slug: "crypto-research-kit" })).toBe("crypto");
    expect(suggestServerName({ kind: "toolset", slug: "web-research" })).toBe("research");
    expect(suggestServerName({ kind: "toolset", slug: "supercalifragilistic" })).toBe("supercali");
    expect(suggestServerName({ kind: "tools", tools: ["get_weather"] })).toBe("weather");
    expect(suggestServerName({ kind: "tools", tools: ["a_b", "c_d"] })).toBe("tools");
    expect(suggestServerName({ kind: "url", url: "https://mcp.example.com/@acme/twitter-kit@3" })).toBe("twitter");
  });

  it("keeps the whole slug when it fits without its dashes, never a fragment (review F)", () => {
    expect(suggestServerName({ kind: "toolset", slug: "tools-i-use" })).toBe("toolsiuse");
    expect(suggestServerName({ kind: "toolset", slug: "my-tools" })).toBe("my-tools");
    expect(suggestServerName({ kind: "toolset", slug: "geo-x-lookups" })).toBe("lookups");
  });

  it("never ends on a one- or two-letter word cut from a longer slug", () => {
    for (const slug of ["tools-i-use-daily", "geo-x-lookups", "maps-of-the-world"]) {
      const name = suggestServerName({ kind: "toolset", slug });
      expect(name, slug).not.toMatch(/-[a-z0-9]{1,2}$/);
    }
  });

  it("never goes over 9 characters or ends on a dash", () => {
    for (const slug of ["abcdefgh-ijk", "a-very-long-slug-indeed", "x1"]) {
      const name = suggestServerName({ kind: "toolset", slug });
      expect(name.length).toBeLessThanOrEqual(9);
      expect(name.endsWith("-")).toBe(false);
    }
  });
});

describe("the snippet for each of the four clients", () => {
  const url = "https://mcp.example.com/";
  it("has the four tabs in order, Claude Code first", () => {
    expect(MCP_CLIENTS.map((c) => c.label)).toEqual(["Claude Code", "Claude Desktop", "Cursor", "Other"]);
  });

  it("Claude Code: one `claude mcp add` line with the full key", () => {
    expect(mcpConfig("claude-code", { url, token: "assay_sk_live_sk1" })).toBe(
      'claude mcp add --transport http assay https://mcp.example.com/ --header "Authorization: Bearer assay_sk_live_sk1"',
    );
  });

  it("Claude Code quotes a URL with a query, so a shell does not eat `?` or `&`", () => {
    const line = mcpConfig("claude-code", { url: `${url}?tools=a_b,c_d&free=1`, token: null, serverName: "tools" });
    expect(line).toContain('claude mcp add --transport http tools "https://mcp.example.com/?tools=a_b,c_d&free=1"');
    expect(line).toContain(KEY_PLACEHOLDER);
  });

  it("Claude Desktop goes through mcp-remote, under the suggested server name", () => {
    const parsed = JSON.parse(mcpConfig("claude-desktop", { url, token: "k", serverName: "weather" }));
    expect(Object.keys(parsed.mcpServers)).toEqual(["weather"]);
    expect(parsed.mcpServers.weather.args).toContain(url);
    expect(parsed.mcpServers.weather.env.ASSAY_AUTH).toBe("Bearer k");
  });

  it("Cursor and Other take the URL and the header", () => {
    expect(JSON.parse(mcpConfig("cursor", { url, token: "k" })).mcpServers.assay).toEqual({ url, headers: { Authorization: "Bearer k" } });
    expect(JSON.parse(mcpConfig("other", { url, token: "k" })).mcpServers.assay).toEqual({
      type: "http",
      url,
      headers: { Authorization: "Bearer k" },
    });
  });

  it("names an API key live by its prefix", () => {
    expect(keyMode("assay_sk_live_ab12")).toBe("live");
    expect(keyMode(null)).toBeNull();
  });
});

describe("mcpToolName — what goes in ?tools=", () => {
  it("is the tool's MCP name, else its id, never a display name", () => {
    expect(mcpToolName({ name: "get_weather", toolId: "06399979" })).toBe("get_weather");
    expect(mcpToolName({ name: "Market quote", toolId: "market-quote" })).toBe("market-quote");
    expect(mcpToolName({ name: "Market quote", id: "06399979-f8b8-4c9e-a9b1-bd2a5924d442" })).toBeNull();
  });
});

describe("one naming convention for tools, unique server names", () => {
  it("names a tool as the agent calls it, with its title only when it differs", () => {
    expect(toolDisplay({ name: "get_weather", toolId: "x" })).toEqual({ name: "get_weather", title: null });
    expect(toolDisplay({ name: "Market quote", toolId: "market-quote" })).toEqual({ name: "market-quote", title: "Market quote" });
  });

  it("never suggests a server name another server of the agent uses", () => {
    expect(uniqueServerName("weather", ["research"])).toBe("weather");
    expect(uniqueServerName("weather", ["weather", null])).toBe("weather2");
    expect(uniqueServerName("crypto-re", ["crypto-re", "crypto-r2"])).toBe("crypto-r3");
  });
});

describe("T2 forms: topics, shared sets, links, version locks", () => {
  it("builds each answer in the form §7.4 lists", () => {
    expect(buildMcpUrl({ kind: "topic", category: "weather" }, { free: false }, HOST)).toBe("https://mcp.example.com/c/weather");
    expect(buildMcpUrl({ kind: "maker", handle: "acme" }, { free: false }, HOST)).toBe("https://mcp.example.com/@acme");
    expect(buildMcpUrl({ kind: "shared", handle: "acme", slug: "twitter-kit", version: 3 }, { free: false }, HOST)).toBe("https://mcp.example.com/@acme/twitter-kit@3");
    expect(buildMcpUrl({ kind: "shared", handle: "acme", slug: "twitter-kit", version: null }, { free: false }, HOST)).toBe("https://mcp.example.com/@acme/twitter-kit");
    expect(buildMcpUrl({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz", version: 2 }, { free: true }, HOST)).toBe("https://mcp.example.com/u/h3j8d2k9s6a1f4g7l0q5wz@2?free=1");
    expect(buildMcpUrl({ kind: "toolset", slug: "research", version: 4 }, { free: false }, HOST)).toBe("https://mcp.example.com/my/research@4");
  });

  it("adds discovery= only when it differs from the URL's default", () => {
    // The root searches by default.
    expect(buildMcpUrl({ kind: "everything" }, { free: false, discovery: "search" }, HOST)).toBe("https://mcp.example.com/");
    expect(buildMcpUrl({ kind: "everything" }, { free: false, discovery: "full" }, HOST)).toBe("https://mcp.example.com/?discovery=full");
    // `?tools=` on the root is automatic, so search is not the default there.
    expect(buildMcpUrl({ kind: "tools", tools: ["a_b"] }, { free: false, discovery: "search" }, HOST)).toBe("https://mcp.example.com/?tools=a_b&discovery=search");
    expect(buildMcpUrl({ kind: "tools", tools: ["a_b"] }, { free: true, discovery: "auto" }, HOST)).toBe("https://mcp.example.com/?tools=a_b&free=1");
    expect(buildMcpUrl({ kind: "topic", category: "web" }, { free: false, discovery: "auto" }, HOST)).toBe("https://mcp.example.com/c/web");
    // A tool set's own default is not in its URL, so any choice is written out.
    expect(buildMcpUrl({ kind: "shared", handle: "acme", slug: "kit", version: 2 }, { free: false, discovery: "search" }, HOST)).toBe(
      "https://mcp.example.com/@acme/kit@2?discovery=search",
    );
    expect(defaultDiscovery({ kind: "toolset", slug: "kit" })).toBeNull();
  });

  it("reads them back, with the version and a discovery that is not the default", () => {
    expect(parseMcpUrl("https://mcp.example.com/c/weather", HOST)?.choice).toEqual({ kind: "topic", category: "weather" });
    expect(parseMcpUrl("https://mcp.example.com/@acme", HOST)?.choice).toEqual({ kind: "maker", handle: "acme" });
    expect(parseMcpUrl("https://mcp.example.com/@acme/kit@3?discovery=full", HOST)).toEqual({
      choice: { kind: "shared", handle: "acme", slug: "kit", version: 3 },
      options: { free: false, discovery: "full" },
    });
    expect(parseMcpUrl("https://mcp.example.com/u/h3j8d2k9s6a1f4g7l0q5wz@2", HOST)?.choice).toEqual({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz", version: 2 });
    expect(parseMcpUrl("https://mcp.example.com/my/research@4", HOST)?.choice).toEqual({ kind: "toolset", slug: "research", version: 4 });
    // A default discovery is dropped, as the server drops it.
    expect(parseMcpUrl("https://mcp.example.com/?discovery=search", HOST)?.options).toEqual({ free: false });
    expect(parseMcpUrl("https://mcp.example.com/?discovery=sideways", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/@acme/kit@x", HOST)?.choice.kind).toBe("url");
  });

  it("round-trips every form with every option", () => {
    const choices: ConnectChoice[] = [
      { kind: "everything" },
      { kind: "topic", category: "weather" },
      { kind: "shared", handle: "acme", slug: "kit", version: 3 },
      { kind: "shared", handle: "acme", slug: "kit" },
      { kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz", version: 1 },
      { kind: "toolset", slug: "research", version: 2 },
      { kind: "tools", tools: ["a_x", "b_y"] },
    ];
    for (const choice of choices) {
      for (const discovery of [undefined, "auto", "full", "search"] as const) {
        const url = buildMcpUrl(choice, { free: true, discovery }, HOST);
        const parsed = parseMcpUrl(url, HOST)!;
        expect(sameChoice(parsed.choice, choice)).toBe(true);
        expect(buildMcpUrl(parsed.choice, parsed.options, HOST)).toBe(url);
      }
    }
  });

  it("names their servers and their web pages; the link token stays in the fragment", () => {
    expect(suggestServerName({ kind: "topic", category: "weather" })).toBe("weather");
    expect(suggestServerName({ kind: "shared", handle: "marketkit", slug: "crypto-research", version: 2 })).toBe("crypto");
    expect(suggestServerName({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz" })).toBe("shared");
    expect(webPageOf({ kind: "shared", handle: "acme", slug: "kit", version: 3 })).toBe("/toolsets/view?handle=acme&slug=kit&v=3");
    expect(webPageOf({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz", version: 2 })).toBe("/toolsets/view#token=h3j8d2k9s6a1f4g7l0q5wz&v=2");
    expect(webPageOf({ kind: "maker", handle: "acme" })).toBe("/toolsets/handle?handle=acme");
    expect(webPageOf({ kind: "topic", category: "web" })).toBe("/catalogue?category=web");
  });
});
