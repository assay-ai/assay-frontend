import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { apiKeyConfig, installCommand, KEY_PLACEHOLDER, keyMode, MCP_CLIENTS } from "@/features/buyer-money/mcp-config";

import {
  buildMcpUrl,
  signInHint,
  canonicalTools,
  defaultDiscovery,
  mcpToolName,
  toolDisplay,
  uniqueServerName,
  parseMcpUrl,
  RESERVED_FIRST_SEGMENTS,
  sameChoice,
  defaultServerName,
  defaultServerNameFor,
  fitsServerName,
  isValidServerName,
  longestToolLength,
  maxServerNameLength,
  serverNameRefusal,
  DEFAULT_NAME_RULE,
  MAX_SERVER_NAME_LENGTH,
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
    expect(parseMcpUrl("https://mcp.example.com/OAUTH/x", HOST)).toBeNull();
    expect(parseMcpUrl("https://mcp.example.com/.Well-Known/x", HOST)).toBeNull();
    // Only the first segment is reserved: the same word further in still parses.
    expect(parseMcpUrl("https://mcp.example.com/@acme/oauth", HOST)?.choice).toEqual({ kind: "shared", handle: "acme", slug: "oauth" });
    expect(parseMcpUrl("https://mcp.example.com/my/docs", HOST)?.choice).toEqual({ kind: "toolset", slug: "docs" });
    expect(RESERVED_FIRST_SEGMENTS).toEqual(["t", ".well-known", "health", "status", "docs", "oauth"]);
  });

  it("works on the unconfigured placeholder host too", () => {
    expect(parseMcpUrl("https://<your-mcp-host>/my/kit", "https://<your-mcp-host>")?.choice).toEqual({ kind: "toolset", slug: "kit" });
  });
});

describe("defaultServerName — assay, or assay-{slug} (spec 8.3.1)", () => {
  it("names each answer", () => {
    expect(defaultServerName({ kind: "everything" })).toBe("assay");
    expect(defaultServerName({ kind: "toolset", slug: "research" }, 20)).toBe("assay-research");
    expect(defaultServerName({ kind: "toolset", slug: "crypto-research-kit" }, 20)).toBe("assay-crypto-research-kit");
    expect(defaultServerName({ kind: "topic", category: "weather" }, 20)).toBe("assay-weather");
    expect(defaultServerName({ kind: "shared", handle: "marketkit", slug: "crypto-research", version: 2 }, 20)).toBe("assay-crypto-research");
    expect(defaultServerName({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz" }, 20)).toBe("assay");
    expect(defaultServerName({ kind: "tools", tools: ["get_weather"] }, 20)).toBe("assay-weather");
    expect(defaultServerName({ kind: "tools", tools: ["a_b", "c_d"] }, 20)).toBe("assay-tools");
    expect(defaultServerName({ kind: "url", url: "https://mcp.example.com/@acme/twitter-kit@3" }, 20)).toBe("assay-twitter-kit");
  });

  it("drops trailing words until it fits, then falls back to assay", () => {
    const choice: ConnectChoice = { kind: "toolset", slug: "twitter-kit-pro" };
    expect(defaultServerName(choice, 40)).toBe("assay-twitter-kit");
    expect(defaultServerName(choice, 44)).toBe("assay-twitter");
    expect(defaultServerName(choice, 46)).toBe("assay");
  });

  it("unmeasured (signed out, L 48) falls back to assay", () => {
    expect(defaultServerName({ kind: "toolset", slug: "research" })).toBe("assay");
  });

  it("always yields a valid name that fits", () => {
    for (const slug of ["a-very-long-slug-indeed-with-many-words-in-it-to-overflow", "x1", "my_kit"]) {
      const name = defaultServerName({ kind: "toolset", slug }, 20);
      expect(isValidServerName(name)).toBe(true);
      expect(fitsServerName(name, 20)).toBe(true);
    }
  });
});

describe("the server-name rule agrees with assay-mcp on every shared vector (R-MU-9)", () => {
  const here = join(process.cwd(), "src/features/connect");
  const read = (file: string) => readFileSync(join(here, file), "utf8");
  const vectors = JSON.parse(read("server-name.vectors.json"));
  const source = JSON.parse(read("assay-mcp-vectors.source.json"));

  it("the vector copies are the ones recorded from the assay-mcp ref", () => {
    expect(source.ref).toMatch(/^[0-9a-f]{40}$|^v?\d+\.\d+\.\d+/);
    for (const [file, info] of Object.entries(source.files as Record<string, { sha256: string }>)) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      expect(createHash("sha256").update(text, "utf8").digest("hex"), file).toBe(info.sha256);
    }
  });

  it("the rule values match", () => {
    expect(DEFAULT_NAME_RULE).toEqual({ budget: vectors.rule.budget, overhead: vectors.rule.overhead });
    expect(MAX_SERVER_NAME_LENGTH).toBe(vectors.rule.maxLength);
    expect(new RegExp(vectors.rule.pattern).source).toBe(/^[a-z][a-z0-9-]*$/.source);
    expect(longestToolLength(null)).toBe(vectors.rule.signedOutL);
  });

  it("the sign-in hint is the vector text with the pinned scoped command", () => {
    expect(signInHint()).toBe(vectors.rule.signedOutHint.replace("{run}", "npx -y @goassay-ai/mcp@1.2.3"));
  });

  it("maximum name length", () => {
    for (const c of vectors.maxLength) {
      expect(Math.max(0, maxServerNameLength(c.L)), c.name).toBe(c.max);
    }
  });

  it("valid names", () => {
    for (const c of vectors.valid) expect(isValidServerName(c.name), JSON.stringify(c.name)).toBe(c.ok);
  });

  it("fits", () => {
    for (const c of vectors.fits) expect(fitsServerName(c.name, c.L), `${c.name} ${c.L}`).toBe(c.fits);
  });

  it("longest tool", () => {
    for (const c of vectors.longestTool) {
      const listed =
        c.mode === "signedOut" ? null : c.mode === "search" ? [...vectors.searchMetaTools, ...c.pinned] : c.tools;
      expect(longestToolLength(listed), c.name).toBe(c.L);
    }
  });

  it("default names", () => {
    for (const c of vectors.defaultName) {
      expect(defaultServerNameFor(c.urlKind === "ROOT", c.slugWords, c.L), c.name).toBe(c.expect);
    }
  });

  it("uniqueness within the budget", () => {
    for (const c of vectors.unique) expect(uniqueServerName(c.base, c.taken, c.L), c.name).toBe(c.expect);
  });

  it("refusals, with the exact message", () => {
    for (const c of vectors.refusal) {
      const r = serverNameRefusal(c.typed, c.L);
      expect(r?.kind, c.name).toBe(c.kind);
      expect(r?.message, c.name).toBe(c.message);
    }
  });

  it("accepts a name that fits", () => {
    expect(serverNameRefusal("assay-weather", 20)).toBeNull();
  });
});

describe("the snippet for each client", () => {
  const url = "https://mcp.example.com/";
  it("lists the clients in CONNECT_CLIENTS order, Claude Code first, My own code last", () => {
    expect(MCP_CLIENTS.map((c) => c.id)).toEqual(["claude-code", "codex", "cursor", "vscode", "windsurf", "gemini", "claude-desktop", "claude-ai", "chatgpt", "other"]);
    expect(MCP_CLIENTS.at(-1)?.label).toBe("My own code");
  });

  it("Claude Code: the pinned proxy, no key and no header", () => {
    expect(installCommand("claude-code", { V: "1.2.3", url, name: "assay" })).toBe("claude mcp add --scope user assay -- npx -y @goassay-ai/mcp@1.2.3 --name assay");
  });

  it("a URL with a query is quoted, so a shell does not eat `?` or `&`", () => {
    const line = installCommand("claude-code", { V: "1.2.3", url: `${url}?tools=a_b,c_d&free=1`, name: "tools" }) as string;
    expect(line).toContain("--url 'https://mcp.example.com/?tools=a_b,c_d&free=1'");
  });

  it("My own code takes the URL and the header", () => {
    expect(JSON.parse(apiKeyConfig({ url, token: "k" })).mcpServers.assay).toEqual({ type: "http", url, headers: { Authorization: "Bearer k" } });
    expect(apiKeyConfig({ url, token: null })).toContain(KEY_PLACEHOLDER);
  });

  it("names an API key live by its hint", () => {
    expect(keyMode("assay_sk_live_…ab12")).toBe("live");
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

  it("throws, like the proxy, when no unique name fits", () => {
    expect(() => uniqueServerName("aaa", ["aaa"], 58)).toThrow(/no free server name/);
  });

  it("never suggests a server name another server of the agent uses", () => {
    expect(uniqueServerName("weather", ["research"])).toBe("weather");
    expect(uniqueServerName("weather", ["weather", null])).toBe("weather-2");
    expect(uniqueServerName("assay-weather", ["assay-weather", "assay-weather-2"], 20)).toBe("assay-weather-3");
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
    expect(defaultServerName({ kind: "topic", category: "weather" }, 20)).toBe("assay-weather");
    expect(defaultServerName({ kind: "shared", handle: "marketkit", slug: "crypto-research", version: 2 }, 20)).toBe("assay-crypto-research");
    expect(defaultServerName({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz" }, 20)).toBe("assay");
    expect(webPageOf({ kind: "shared", handle: "acme", slug: "kit", version: 3 })).toBe("/toolsets/view?handle=acme&slug=kit&v=3");
    expect(webPageOf({ kind: "link", token: "h3j8d2k9s6a1f4g7l0q5wz", version: 2 })).toBe("/toolsets/view#token=h3j8d2k9s6a1f4g7l0q5wz&v=2");
    expect(webPageOf({ kind: "maker", handle: "acme" })).toBe("/toolsets/handle?handle=acme");
    expect(webPageOf({ kind: "topic", category: "web" })).toBe("/catalogue?category=web");
  });
});
