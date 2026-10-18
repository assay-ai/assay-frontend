import { describe, expect, it } from "vitest";

import type { AgentAccess, AgentToolEffect, McpUrlPreview, RefusedCall } from "@/services/toolsets.service";

import {
  accessSummary,
  unusableTools,
  allowToolsBody,
  excludeProviderBody,
  includeProviderBody,
  limitPhrases,
  modeBody,
  priceText,
  toolResultLine,
  toolResultTone,
  verifiedOnlyBody,
  draftBody,
  draftChanges,
  draftFrom,
  restoreBody,
} from "./access-result";
import { defaultEntry, entryChipLabel, entryProblem, providersLeft, slugFrom } from "./entry-rules";
import { ON_EMPTY_LABELS, PROVIDER_MODE_LABELS, REFUSAL_LAYER_LABELS } from "./labels";
import { copyBlocked, offersFreeOnly, overBudgetWith, previewCounts, previewSummary, previewWarnings, tokensText } from "./preview";
import { providerReason, refusedCallView, viaText } from "./refused";

const ASSET = "eip155:1/erc20:0xabc";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

function tool(over: Partial<AgentToolEffect> = {}): AgentToolEffect {
  return { toolId: "t-weather", name: "get_weather", category: "weather", access: "ALLOWED", providersTotal: 4, providersLeft: 2, ...over };
}

function access(over: Partial<AgentAccess> = {}): AgentAccess {
  return {
    agentId: "a1",
    scope: "AGENT",
    policyVersion: 2,
    accessMode: "RESTRICTED",
    allowedToolsets: [{ toolsetId: "s1", version: null, viaUrlOnly: true, name: "Research kit", slug: "research", deleted: false }],
    allowedToolIds: ["t-weather"],
    rules: { excludeProviderIds: [], maxPrice: usd("10000"), minTier: null, minQuality: null },
    pinnedTools: [],
    tools: [tool(), tool({ toolId: "t-geo", name: "geocode_place", access: "BLOCKED" })],
    ...over,
  };
}

describe("What this agent can use — the combined result per tool", () => {
  it("says how many providers are left, and which limit cut them", () => {
    expect(toolResultLine(tool(), access().rules)).toBe("get_weather: 2 of 4 providers left (your limit: max $0.01)");
    expect(
      toolResultLine(tool(), { excludeProviderIds: ["p1", "p2"], maxPrice: usd("2500"), minTier: "ESTABLISHED", minQuality: null }),
    ).toBe("get_weather: 2 of 4 providers left (your limits: max $0.0025, only verified, 2 providers excluded)");
  });

  it("names the plain states: all, one with no backup, none fits, nobody serves it, not allowed", () => {
    const rules = { excludeProviderIds: [], maxPrice: null, minTier: null, minQuality: null };
    expect(toolResultLine(tool({ providersLeft: 4 }), rules)).toBe("get_weather: all 4 providers");
    expect(toolResultLine(tool({ providersTotal: 2, providersLeft: 2 }), rules)).toBe("get_weather: both providers");
    expect(toolResultLine(tool({ providersTotal: 1, providersLeft: 1 }), rules)).toBe("get_weather: 1 provider, no backup");
    expect(toolResultLine(tool({ providersLeft: 0 }), access().rules)).toBe("get_weather: no provider fits (your limit: max $0.01)");
    expect(toolResultLine(tool({ providersTotal: 0, providersLeft: 0 }), rules)).toBe("get_weather: no provider is taking calls for it now");
    expect(toolResultLine(tool({ access: "BLOCKED" }), rules)).toBe("get_weather: not in this agent's list");
    expect(toolResultLine(tool({ access: "VIA_TOOLSET_URL", providersLeft: 4 }), rules)).toBe(
      "get_weather: all 4 providers · only through its tool set's URL",
    );
  });

  it("tones a row by what it means", () => {
    expect(toolResultTone(tool({ access: "BLOCKED" }))).toBe("blocked");
    expect(toolResultTone(tool({ providersLeft: 1 }))).toBe("warn");
    expect(toolResultTone(tool())).toBe("ok");
  });

  it("prints a price limit to the cent, or to four places when it needs them", () => {
    expect(priceText(usd("10000"))).toBe("$0.01");
    expect(priceText(usd("2500"))).toBe("$0.0025");
    expect(priceText(null)).toBeNull();
    expect(limitPhrases({ excludeProviderIds: [], maxPrice: null, minTier: "TRUSTED", minQuality: null })).toEqual(["only trusted"]);
  });

  it("summarises the agent's access in one line", () => {
    expect(accessSummary(access())).toBe("Can use 1 of 2 tools.");
    expect(accessSummary(access({ accessMode: "ALL" }))).toMatch(/^Can use every tool, including new ones\. 2 of 2/);
  });

  it("names every tool it may use but cannot run, with the reason, instead of a bare \"1 of 8\"", () => {
    const rules = { excludeProviderIds: [], maxPrice: usd("10000"), minTier: null, minQuality: null };
    const everything = access({
      accessMode: "ALL",
      rules,
      tools: [
        tool({ providersTotal: 2, providersLeft: 2 }),
        tool({ toolId: "t-geo", name: "geocode_place", providersTotal: 0, providersLeft: 0 }),
        tool({ toolId: "t-fx", name: "get_usd_eur_rate", providersTotal: 1, providersLeft: 0 }),
      ],
    });
    expect(accessSummary(everything)).toBe(
      "Can use every tool, including new ones. 1 of 3 can run now; 2 can't (1 with no provider taking calls, 1 outside its limits).",
    );
    expect(unusableTools(everything)).toEqual([
      { toolId: "t-geo", name: "geocode_place", reason: "no-provider", text: "no provider is taking calls for it now" },
      { toolId: "t-fx", name: "get_usd_eur_rate", reason: "limits", text: "every provider is outside this agent's limits (max $0.01)" },
    ]);
    // A blocked tool is "not in this agent's list", not a tool that can't run.
    expect(unusableTools(access({ tools: [tool({ access: "BLOCKED", providersLeft: 0 })] }))).toEqual([]);
    expect(accessSummary(access({ tools: [tool(), tool({ toolId: "t-geo", name: "geocode_place", providersTotal: 0, providersLeft: 0 })] }))).toBe(
      "Can use 2 of 2 tools. 1 of them can't run now (1 with no provider taking calls).",
    );
    expect(accessSummary(access({ tools: [tool({ access: "BLOCKED" })] }))).toMatch(/no tool at all/);
  });

  it("[Allow them] adds only the missing tools, and does nothing on Everything", () => {
    expect(allowToolsBody(access(), ["t-geo", "t-weather"], ["geocode_place"])).toEqual({
      allowedToolIds: ["t-weather", "t-geo"],
      changeReason: "Allowed geocode_place",
    });
    expect(allowToolsBody(access(), ["t-weather"])).toBeNull();
    expect(allowToolsBody(access({ accessMode: "ALL" }), ["t-geo"])).toBeNull();
  });

  it("switching to Only these from nothing starts from the tools it can use, so it is not cut off", () => {
    const fresh = access({ accessMode: "ALL", allowedToolIds: [], allowedToolsets: [] });
    expect(modeBody(fresh, "RESTRICTED").allowedToolIds).toEqual(["t-weather", "t-geo"]);
    expect(modeBody(access(), "RESTRICTED").allowedToolIds).toBeUndefined();
    expect(modeBody(access(), "ALL")).toEqual({ accessMode: "ALL", changeReason: "Allowed every tool" });
  });

  it("writes provider limits as partial rules", () => {
    expect(excludeProviderBody(access().rules, "p1", "Acme").rules).toEqual({ excludeProviderIds: ["p1"] });
    expect(includeProviderBody({ ...access().rules, excludeProviderIds: ["p1", "p2"] }, "p1", "Acme").rules).toEqual({ excludeProviderIds: ["p2"] });
    expect(verifiedOnlyBody(true).rules).toEqual({ minTier: "ESTABLISHED" });
    expect(verifiedOnlyBody(false).rules).toEqual({ minTier: null });
  });
});

function preview(over: Partial<McpUrlPreview> = {}): McpUrlPreview {
  return {
    canonicalUrl: "https://mcp.example.com/",
    endpointKind: "ROOT",
    toolsetId: null,
    toolsetName: null,
    viewFilter: null,
    discovery: "FULL",
    listedCount: 12,
    estimatedTokens: 2_840,
    freeOnly: false,
    tools: [
      { toolId: "t1", name: "get_weather", category: "weather", listed: true, allowed: true, pricingMode: "PAID", price: "up to $0.002", providerCount: 3, noProviderFits: false },
      { toolId: "t2", name: "search_web", category: "web", listed: false, allowed: false, pricingMode: "PAID", price: null, providerCount: 4, noProviderFits: false },
    ],
    ignoredTools: [],
    warnings: [],
    ...over,
  };
}

describe("the Connect sheet's preview states", () => {
  it("says what the agent will see, from one set of counts, with an estimate that always carries a tilde", () => {
    const allListed = preview({ tools: [preview().tools[0]!], listedCount: 1, estimatedTokens: 236 });
    expect(previewSummary(allListed)).toBe("Your agent will see 1 tool (~240 tokens).");
    // Everything for a restricted agent: what it sees, and how many more are blocked.
    expect(previewSummary(preview({ listedCount: 1 }))).toBe("2 tools here: 1 ready to use, 1 blocked for this agent (~2.8k tokens).");
    // A listed tool no provider can run is counted as listed, not as usable.
    const noFit = preview({ tools: [preview().tools[0]!, { ...preview().tools[0]!, toolId: "t3", name: "x_y", noProviderFits: true }], listedCount: 2 });
    expect(previewSummary(noFit)).toBe("2 tools here: 1 ready to use, 1 with no provider that fits its limits (~2.8k tokens).");
    expect(previewCounts(noFit)).toEqual({ inView: 2, listed: 2, usable: 1, blocked: 0 });
    expect(previewSummary(preview({ listedCount: 0, tools: [preview().tools[1]!] }))).toBe("1 tool here: none ready to use, 1 blocked for this agent.");
    expect(tokensText(12_400)).toBe("~12k");
    expect(tokensText(3)).toBe("~10");
  });

  it("blocked by access: a warning with [Allow them] carrying the blocked tools' ids", () => {
    const p = preview({ warnings: [{ code: "BLOCKED_BY_ACCESS", tools: [{ toolId: "t2", name: "search_web" }] }] });
    const warnings = previewWarnings(p);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "BLOCKED_BY_ACCESS", text: "search_web is blocked for this agent." });
    expect(warnings[0]!.fix).toEqual({ kind: "allow-tools", toolIds: ["t2"], toolNames: ["search_web"] });
    expect(copyBlocked(p)).toBe(false);
  });

  it("nothing allowed: one danger line instead of the blocked one, and Copy is off", () => {
    const p = preview({
      listedCount: 0,
      warnings: [
        { code: "BLOCKED_BY_ACCESS", tools: [{ toolId: "t1", name: "get_weather" }, { toolId: "t2", name: "search_web" }] },
        { code: "NOTHING_ALLOWED", tools: [] },
      ],
    });
    const warnings = previewWarnings(p);
    expect(warnings.map((w) => w.code)).toEqual(["NOTHING_ALLOWED"]);
    expect(warnings[0]!.tone).toBe("danger");
    expect(warnings[0]!.fix).toMatchObject({ kind: "allow-tools", toolIds: ["t1", "t2"] });
    expect(copyBlocked(p)).toBe(true);
  });

  it("orders the lines by what to act on, one line per tool, and leaves unknown names out", () => {
    const warnings = previewWarnings(
      preview({
        warnings: [
          { code: "NO_BACKUP_PROVIDER", tools: ["a", "b", "c", "d", "get_weather"].map((name) => ({ toolId: `t-${name}`, name })) },
          { code: "NO_PROVIDER_FITS", tools: [{ toolId: "t1", name: "get_weather" }] },
          { code: "IGNORED_TOOLS", tools: [{ toolId: null, name: "nope" }] },
        ],
      }),
    );
    expect(warnings.map((w) => w.text)).toEqual([
      "No provider fits this agent's provider limits for get_weather, so it can't run now.",
      "Only one provider offers each of a, b, c and 1 more: if one is down, that call fails.",
      "Not found, so left out: nope.",
    ]);
    expect(warnings[0]!.fix).toEqual({ kind: "open-access" });
  });

  it("a single provider is said in plain words", () => {
    expect(previewWarnings(preview({ warnings: [{ code: "NO_BACKUP_PROVIDER", tools: [{ toolId: "t1", name: "get_weather" }] }] }))[0]!.text).toBe(
      "Only one provider offers get_weather: if it is down, the call fails.",
    );
  });

  it("over budget counts this server plus the agent's other servers, once each", () => {
    const row = (url: string, toolCount: number) => ({
      canonicalUrl: url,
      endpointKind: "ROOT" as const,
      toolsetId: null,
      name: "x",
      serverName: null,
      client: null,
      toolCount,
      estimatedTokens: 100,
      discovery: "FULL" as const,
      lastCallAt: null,
      handedOutAt: null,
      firstCallAt: null,
      waitingForFirstCall: false,
      available: true,
      updateAvailable: false,
    });
    expect(overBudgetWith(preview(), [row("https://mcp.example.com/my/a", 10)])).toBeNull();
    expect(overBudgetWith(preview(), [row("https://mcp.example.com/my/a", 14)])).toBe(26);
    // The same URL is not counted twice.
    expect(overBudgetWith(preview(), [row("https://mcp.example.com/", 30)])).toBeNull();
  });

  it("offers Only free tools only when something here can be free", () => {
    expect(offersFreeOnly(preview())).toBe(false);
    expect(offersFreeOnly(preview({ tools: [{ ...preview().tools[0]!, pricingMode: "FREEMIUM" }] }))).toBe(true);
    expect(offersFreeOnly(undefined)).toBe(false);
  });
});

function refused(over: Partial<RefusedCall> = {}): RefusedCall {
  return {
    callId: "c1",
    agentId: "a1",
    toolId: "t-tweets",
    toolName: "acme__search_tweets",
    refusalCode: "NO_PROVIDER_MATCHES_RULES",
    refusalLayer: "AGENT_LIMITS",
    charged: false,
    providers: [{ providerId: "p-acme", providerName: null, reason: "EXCLUDED_BY_AGENT", source: "AGENT", detail: "Excluded by the agent's rules" }],
    endpointKind: "TOOLSET",
    toolsetId: "s1",
    toolsetVersion: null,
    viewFilter: null,
    createdAt: "2026-10-17T14:02:00.000Z",
    ...over,
  };
}

describe("a refused call, as sketch B draws it", () => {
  it("not charged, the plain reason, the layer, the provider with its fix, the one-provider note", () => {
    const view = refusedCallView(refused());
    expect(view.title).toBe("Call refused · not charged");
    expect(view.reason).toBe("No provider fits your limits.");
    expect(view.layer).toBe("Refused by this agent's provider limits");
    expect(view.providers).toEqual([
      {
        providerId: "p-acme",
        name: null,
        reason: "Blocked by this agent's provider limits",
        source: "This agent's provider limits",
        fix: { kind: "include-provider", providerId: "p-acme", label: "Remove from limits" },
        fixCovers: 1,
      },
    ]);
    expect(view.singleProviderNote).toBe("This tool has one provider, so nothing else can run it.");
  });

  it("each reason in words, with whose rule it was", () => {
    const p = (reason: string, source = "AGENT", detail = "") => providerReason({ providerId: "p", providerName: null, reason, source, detail });
    expect(p("ABOVE_MAX_PRICE")).toBe("Costs more than this agent's max price");
    expect(p("ABOVE_MAX_PRICE", "TOOLSET", "different asset")).toMatch(/different currency than the tool set's max price/);
    expect(p("BELOW_MIN_TIER", "TOOLSET")).toBe("Not verified, and the tool set's limits allow only verified providers");
    expect(p("NOT_IN_ALLOWED_PROVIDERS", "TOOLSET")).toMatch(/Only these/);
    expect(p("EXCLUDED_BY_TOOLSET", "TOOLSET")).toMatch(/All except/);
  });

  it("a tool set's rule is fixed on the tool set; an agent's price and tier limits in one click", () => {
    const view = refusedCallView(
      refused({
        refusalLayer: "TOOLSET_RULES",
        providers: [
          { providerId: "p1", providerName: null, reason: "NOT_IN_ALLOWED_PROVIDERS", source: "TOOLSET", detail: "" },
          { providerId: "p2", providerName: null, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
          { providerId: "p3", providerName: null, reason: "BELOW_MIN_TIER", source: "AGENT", detail: "" },
        ],
      }),
    );
    expect(view.layer).toBe("Refused by both this agent's provider limits and the tool set's rules");
    expect(view.providers.map((p) => p.fix?.kind)).toEqual(["edit-toolset", "clear-max-price", "allow-any-tier"]);
    expect(view.singleProviderNote).toBeNull();
  });

  it("shows each fix once, however many providers it would bring back", () => {
    const view = refusedCallView(
      refused({
        providers: [
          { providerId: "p1", providerName: null, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
          { providerId: "p2", providerName: null, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
        ],
      }),
    );
    expect(view.providers.map((p) => p.fix?.kind ?? null)).toEqual(["clear-max-price", null]);
  });

  it("not allowed: Allow this tool; not on this server: add it to the tool set", () => {
    expect(refusedCallView(refused({ refusalCode: "TOOL_NOT_ALLOWED", providers: [] })).fix).toEqual({
      kind: "allow-tool",
      toolId: "t-tweets",
      label: "Allow this tool",
    });
    const server = refusedCallView(refused({ refusalCode: "TOOL_NOT_IN_TOOLSET", refusalLayer: "SERVER", providers: [] }));
    expect(server.layer).toBe("Refused by the server it called: that server serves only what its tool set lists");
    expect(server.fix).toEqual({ kind: "add-to-toolset", toolsetId: "s1", toolId: "t-tweets", label: "Add it to the tool set" });
    expect(refusedCallView(refused({ refusalCode: "MCP_SPEND_LIMIT_EXCEEDED", providers: [] })).fix).toMatchObject({ href: "/limits" });
  });

  it("says where the call came in", () => {
    expect(viaText(refused(), "twitter")).toBe("via twitter");
    expect(viaText(refused({ endpointKind: "ROOT" }))).toBe("via Everything");
    expect(viaText(refused({ endpointKind: "ROOT", viewFilter: { tools: [{ toolId: "t-get_weather", name: "get_weather" }] } }))).toBe("via Only these tools");
  });
});

describe("refusal wording is never confused with spending limits", () => {
  it("names the tool list for a tool the agent may not use", () => {
    expect(refusedCallView(refused({ refusalCode: "TOOL_NOT_ALLOWED", providers: [] })).layer).toBe(
      "Refused by this agent's tool list: it is not one of the tools this agent may use",
    );
  });
  it("shows a fix once with how many providers it brings back", () => {
    const view = refusedCallView(
      refused({
        providers: [
          { providerId: "p1", providerName: "Acme", reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
          { providerId: "p2", providerName: "Beta", reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
        ],
      }),
    );
    expect(view.providers.map((p) => [p.name, p.fixCovers])).toEqual([
      ["Acme", 2],
      ["Beta", 0],
    ]);
  });
});

describe("a tool set entry's provider rule", () => {
  it("labels the chip in plain words", () => {
    expect(entryChipLabel(defaultEntry("t"))).toBe("Providers: Any (Assay picks)");
    expect(
      entryChipLabel({ ...defaultEntry("t"), providerMode: "ONLY", providerIds: ["a", "b"], minTier: "ESTABLISHED", maxPrice: { amount: "10000", asset: ASSET } }),
    ).toBe("Providers: Only these (2) · verified · max $0.01");
    expect(entryChipLabel({ ...defaultEntry("t"), providerMode: "EXCLUDE", providerIds: ["a"] })).toBe("Providers: All except (1)");
  });

  it("refuses an empty provider list for Only these and All except", () => {
    expect(entryProblem({ providerMode: "ONLY", providerIds: [] })).toMatch(/at least one provider to use/);
    expect(entryProblem({ providerMode: "EXCLUDE", providerIds: [] })).toMatch(/leave out/);
    expect(entryProblem({ providerMode: "BEST", providerIds: [] })).toBeNull();
  });

  it("counts the providers a rule leaves", () => {
    expect(providersLeft({ providerMode: "ONLY", providerIds: ["a"] }, ["a", "b", "c"])).toBe(1);
    expect(providersLeft({ providerMode: "EXCLUDE", providerIds: ["a"] }, ["a", "b", "c"])).toBe(2);
    expect(providersLeft({ providerMode: "BEST", providerIds: [] }, ["a", "b"])).toBe(2);
  });

  it("makes a slug from a name", () => {
    expect(slugFrom("Research kit")).toBe("research-kit");
    expect(slugFrom("Café — Météo!")).toBe("cafe-meteo");
    expect(slugFrom("x")).toBe("x-1");
  });
});

describe("plain labels — no internal word reaches a screen", () => {
  it("translates every mode, fallback and layer", () => {
    const all = [...Object.values(PROVIDER_MODE_LABELS), ...Object.values(ON_EMPTY_LABELS), ...Object.values(REFUSAL_LAYER_LABELS)].join(" ");
    expect(all).not.toMatch(/BEST|ONLY|EXCLUDE|FALLBACK|FAIL|RESTRICTED|discovery|access policy|UNLISTED/);
    expect(PROVIDER_MODE_LABELS.BEST).toBe("Any (Assay picks)");
    expect(ON_EMPTY_LABELS.FALLBACK_BEST).toBe("Let Assay pick the best one");
  });
});

describe("the access draft: one Save, one Cancel, an Undo", () => {
  const everything = access({ accessMode: "ALL", allowedToolsets: [], allowedToolIds: [], rules: { excludeProviderIds: [], maxPrice: null, minTier: null, minQuality: null } });

  it("nothing changed: nothing to save", () => {
    expect(draftBody(everything, draftFrom(everything))).toBeNull();
    expect(draftChanges(everything, draftFrom(everything))).toEqual([]);
  });

  it("limit to 2 tools and exclude 1 provider is one body (Only these, two ticks, one tick, Save)", () => {
    const draft = { ...draftFrom(everything), mode: "RESTRICTED" as const, toolIds: ["t-weather", "t-geo"], exclude: ["p1"] };
    expect(draftBody(everything, draft)).toEqual({
      accessMode: "RESTRICTED",
      allowedToolIds: ["t-weather", "t-geo"],
      rules: { excludeProviderIds: ["p1"] },
      changeReason: "Changed what this agent can use",
    });
    expect(draftChanges(everything, draft)).toEqual(["Only these: 2 tools", "1 provider excluded"]);
  });

  it("only sends what changed, and keeps a TRUSTED tier set through the API", () => {
    const trusted = access({ rules: { ...access().rules, minTier: "TRUSTED" } });
    expect(draftBody(trusted, { ...draftFrom(trusted), maxPrice: null })).toEqual({ rules: { maxPrice: null }, changeReason: "Changed what this agent can use" });
    expect(draftBody(trusted, { ...draftFrom(trusted), verified: false })?.rules).toEqual({ minTier: null });
  });

  it("Undo puts everything back as it was", () => {
    expect(restoreBody(access())).toEqual({
      accessMode: "RESTRICTED",
      allowedToolsets: [{ toolsetId: "s1", version: null, viaUrlOnly: true }],
      allowedToolIds: ["t-weather"],
      rules: { excludeProviderIds: [], maxPrice: "10000", minTier: null },
      changeReason: "Undid a change to what this agent can use",
    });
  });
});

/* ------------------------------------------------------------------ T2 */

import { moveLockBody, pinnedToolsBody, suggestAlwaysLoaded, updateAvailableFor, addToolsetBody } from "./access-result";
import { DISCOVERY_LABELS, lockLabel, settingLabel, VISIBILITY_LABELS } from "./labels";
import { biggestServer, lockedVersionOf, serverLabel, toolsShown } from "./servers";
import type { ServerInUse } from "@/services/toolsets.service";

function server(over: Partial<ServerInUse> = {}): ServerInUse {
  return {
    canonicalUrl: "https://mcp.example.com/",
    endpointKind: "ROOT",
    toolsetId: null,
    name: "assay",
    serverName: "assay",
    client: null,
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
    ...over,
  };
}

describe("search mode in the Connect sheet (T2)", () => {
  it("reads like '4 tools (search) — about 0.9k tokens; 37 tools reachable'", () => {
    expect(previewSummary(preview({ discovery: "SEARCH", listedCount: 4, estimatedTokens: 900, reachableCount: 37 }))).toBe(
      "4 tools (search) — about 0.9k tokens; 37 tools reachable, 1 blocked for this agent",
    );
    const all = preview({ tools: [preview().tools[0]!] });
    expect(previewSummary({ ...all, discovery: "SEARCH", listedCount: 4, estimatedTokens: 900, reachableCount: 37 })).toBe("4 tools (search) — about 0.9k tokens; 37 tools reachable");
    expect(previewSummary(preview({ discovery: "SEARCH", listedCount: 3, estimatedTokens: 570, reachableCount: 1 }))).toBe(
      "3 tools (search) — about 0.6k tokens; 1 of 2 tools reachable, 1 blocked for this agent",
    );
  });
});

describe("over budget counts only the servers that show every tool, and offers 'Switch to search'", () => {
  const full = server({ canonicalUrl: "https://mcp.example.com/?discovery=full", name: "assay", toolCount: 13, discovery: "FULL", searchUrl: "https://mcp.example.com/" });
  const kit = server({ canonicalUrl: "https://mcp.example.com/my/kit", name: "Kit", toolCount: 6, discovery: "FULL", searchUrl: "https://mcp.example.com/my/kit?discovery=search" });
  const searching = server({ canonicalUrl: "https://mcp.example.com/c/web", name: "web", toolCount: 4, discovery: "SEARCH" });

  it("adds up only FULL servers", () => {
    expect(toolsShown([full, kit, searching])).toBe(19);
    expect(toolsShown([searching, server({ toolCount: 40, discovery: "SEARCH" })])).toBe(0);
  });

  it("picks the biggest FULL server that has a search URL to switch", () => {
    expect(biggestServer([kit, full, searching])?.name).toBe("assay");
    expect(biggestServer([searching])).toBeNull();
  });

  it("a search preview never pushes the sheet over budget; a FULL one adds to the other FULL servers", () => {
    expect(overBudgetWith(preview({ canonicalUrl: "https://mcp.example.com/x", discovery: "SEARCH", listedCount: 4 }), [full, kit])).toBeNull();
    expect(overBudgetWith(preview({ canonicalUrl: "https://mcp.example.com/x", discovery: "FULL", listedCount: 7 }), [full, kit, searching])).toBe(26);
    expect(overBudgetWith(preview({ canonicalUrl: "https://mcp.example.com/x", discovery: "FULL", listedCount: 6 }), [full, kit, searching])).toBeNull();
  });

  it("labels shared, link-only, topic and locked rows, and reads their lock", () => {
    const shared = server({ canonicalUrl: "https://mcp.example.com/@acme/kit@2", name: "Kit" });
    expect(serverLabel(shared)).toEqual({ title: "Kit", detail: "@acme/kit · locked to v2" });
    expect(serverLabel(server({ canonicalUrl: "https://mcp.example.com/c/weather" })).title).toBe("Topic: weather");
    expect(serverLabel(server({ canonicalUrl: "https://mcp.example.com/my/kit@3", name: "Kit" })).detail).toBe("Your tool set · locked to v3");
    expect(lockedVersionOf(shared)).toBe(2);
    expect(lockedVersionOf(server({ canonicalUrl: "https://mcp.example.com/@acme/kit" }))).toBeNull();
  });
});

describe("version locks and Always loaded in What this agent can use", () => {
  const foreign = { toolsetId: "s9", version: 2, viaUrlOnly: true, name: "Crypto desk", slug: "crypto", deleted: false, handle: "marketkit", own: false, status: "ACTIVE" as const, latestVersion: 3 };

  it("keeps another org's lock through every edit; the draft never turns it into 'latest'", () => {
    const a = access({ allowedToolsets: [...access().allowedToolsets, foreign] });
    const body = draftBody(a, { ...draftFrom(a), toolIds: [] });
    expect(body?.allowedToolsets).toBeUndefined();
    const withNew = draftBody(a, { ...draftFrom(a), toolsets: [...draftFrom(a).toolsets, { toolsetId: "s10", viaUrlOnly: true, version: 1 }] });
    expect(withNew?.allowedToolsets).toContainEqual({ toolsetId: "s9", version: 2, viaUrlOnly: true });
    expect(restoreBody(a).allowedToolsets).toContainEqual({ toolsetId: "s9", version: 2, viaUrlOnly: true });
  });

  it("moves a lock only on purpose, and adds another org's set locked to a version", () => {
    const a = access({ allowedToolsets: [foreign] });
    expect(moveLockBody(a, "s9", 3, "Crypto desk")).toEqual({ allowedToolsets: [{ toolsetId: "s9", version: 3, viaUrlOnly: true }], changeReason: "Moved Crypto desk to v3" });
    expect(addToolsetBody(access({ allowedToolsets: [] }), "s9", "Crypto desk", 3).allowedToolsets).toEqual([{ toolsetId: "s9", version: 3, viaUrlOnly: true }]);
  });

  it("offers 'Update available' only for a lock behind the newest version that still serves", () => {
    expect(updateAvailableFor(foreign)).toBe(3);
    expect(updateAvailableFor({ ...foreign, latestVersion: 2 })).toBeNull();
    expect(updateAvailableFor({ ...foreign, version: null })).toBeNull();
    expect(updateAvailableFor({ ...foreign, status: "REMOVED" })).toBeNull();
  });

  it("pins at most 5 tools, suggesting the most-called first", () => {
    expect(pinnedToolsBody(["a", "b", "a", "c", "d", "e", "f"]).pinnedTools).toEqual(["a", "b", "c", "d", "e"]);
    const calls = ["get_weather", "search_web", "get_weather", "geocode_place", "get_weather", "search_web"].map((toolName) => ({ toolName }));
    expect(suggestAlwaysLoaded(calls, [])).toEqual(["get_weather", "search_web", "geocode_place"]);
    expect(suggestAlwaysLoaded(calls, ["get_weather"], new Set(["get_weather", "geocode_place"]))).toEqual(["geocode_place"]);
  });
});

describe("T2 plain labels", () => {
  it("never print an internal word", () => {
    const words = [...Object.values(VISIBILITY_LABELS), ...Object.values(DISCOVERY_LABELS), lockLabel(3), settingLabel("discovery"), settingLabel("pinnedTools")];
    for (const word of words) expect(word).not.toMatch(/PRIVATE|UNLISTED|PUBLIC|FULL|SEARCH|discovery|toolset|handle|pinned/);
    expect(VISIBILITY_LABELS).toEqual({ PRIVATE: "Only my team", UNLISTED: "Anyone with the link", PUBLIC: "Listed in the catalogue" });
    expect(lockLabel(3)).toBe("Lock to v3 (no surprise changes)");
  });
});
