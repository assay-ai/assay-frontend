import { describe, expect, it } from "vitest";

import { KEY_PLACEHOLDER, keyMode, mcpConfig, MCP_CLIENTS } from "@/features/buyer-money/mcp-config";

import { buildMcpUrl, canonicalTools, mcpToolName, parseMcpUrl, sameChoice, suggestServerName, type ConnectChoice } from "./mcp-url";

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
    expect(parseMcpUrl("https://mcp.example.com/%40acme/kit", HOST)?.choice).toEqual({ kind: "url", url: "https://mcp.example.com/@acme/kit" });
  });

  it("refuses another host, path tricks and bad tool names: 'We couldn't read this URL'", () => {
    expect(parseMcpUrl("https://elsewhere.example.com/", HOST)).toBeNull();
    expect(parseMcpUrl("not a url", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/my/../x", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com//x", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/?tools=Bad Name!", HOST)).toBeNull();
  });

  it("works on the unconfigured placeholder host too", () => {
    expect(parseMcpUrl("https://<your-mcp-host>/my/kit", "https://<your-mcp-host>")?.choice).toEqual({ kind: "toolset", slug: "kit" });
  });
});

describe("suggestServerName — at most 9 characters", () => {
  it("names each answer", () => {
    expect(suggestServerName({ kind: "everything" })).toBe("assay");
    expect(suggestServerName({ kind: "toolset", slug: "research" })).toBe("research");
    expect(suggestServerName({ kind: "toolset", slug: "crypto-research-kit" })).toBe("crypto-re");
    expect(suggestServerName({ kind: "tools", tools: ["get_weather"] })).toBe("weather");
    expect(suggestServerName({ kind: "tools", tools: ["a_b", "c_d"] })).toBe("tools");
    expect(suggestServerName({ kind: "url", url: "https://mcp.example.com/@acme/twitter-kit@3" })).toBe("twitter-k");
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
    expect(mcpConfig("claude-code", { url, token: "assay_live_sk1" })).toBe(
      'claude mcp add --transport http assay https://mcp.example.com/ --header "Authorization: Bearer assay_live_sk1"',
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

  it("names a live or test key by its prefix", () => {
    expect(keyMode("assay_live_ab12")).toBe("live");
    expect(keyMode("assay_test_ab12")).toBe("test");
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
