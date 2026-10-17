import { describe, expect, it } from "vitest";

import type { AgentAccess, AgentToolEffect, McpUrlPreview, RefusedCall } from "@/services/toolsets.service";

import {
  accessSummary,
  allowToolsBody,
  excludeProviderBody,
  includeProviderBody,
  limitPhrases,
  modeBody,
  priceText,
  toolResultLine,
  toolResultTone,
  verifiedOnlyBody,
} from "./access-result";
import { defaultEntry, entryChipLabel, entryProblem, providersLeft, slugFrom } from "./entry-rules";
import { ON_EMPTY_LABELS, PROVIDER_MODE_LABELS, REFUSAL_LAYER_LABELS } from "./labels";
import { copyBlocked, offersFreeOnly, overBudgetWith, previewSummary, previewWarnings, tokensText } from "./preview";
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
    expect(toolResultLine(tool({ providersTotal: 0, providersLeft: 0 }), rules)).toBe("get_weather: no provider serves it yet");
    expect(toolResultLine(tool({ access: "BLOCKED" }), rules)).toBe("get_weather: not allowed");
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
  it("says what the agent will see, with an estimate that always carries a tilde", () => {
    expect(previewSummary(preview())).toBe("Your agent will see 12 tools (~2.8k tokens)");
    expect(previewSummary(preview({ listedCount: 1, estimatedTokens: 236 }))).toBe("Your agent will see 1 tool (~240 tokens)");
    expect(previewSummary(preview({ listedCount: 0 }))).toBe("Your agent will see no tools here.");
    expect(tokensText(12_400)).toBe("~12k");
    expect(tokensText(3)).toBe("~10");
  });

  it("blocked by access: a warning with [Allow them] carrying the blocked tools", () => {
    const warnings = previewWarnings(preview({ warnings: [{ code: "BLOCKED_BY_ACCESS", tools: ["search_web"] }] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "BLOCKED_BY_ACCESS", text: "search_web is blocked for this agent." });
    expect(warnings[0]!.fix).toEqual({ kind: "allow-tools", toolIds: ["t2"], toolNames: ["search_web"] });
    expect(copyBlocked(preview({ warnings: [{ code: "BLOCKED_BY_ACCESS", tools: ["search_web"] }] }))).toBe(false);
  });

  it("nothing allowed: one danger line instead of the blocked one, and Copy is off", () => {
    const p = preview({
      listedCount: 0,
      warnings: [
        { code: "BLOCKED_BY_ACCESS", tools: ["get_weather", "search_web"] },
        { code: "NOTHING_ALLOWED", tools: [] },
      ],
    });
    const warnings = previewWarnings(p);
    expect(warnings.map((w) => w.code)).toEqual(["NOTHING_ALLOWED"]);
    expect(warnings[0]!.tone).toBe("danger");
    expect(copyBlocked(p)).toBe(true);
  });

  it("no backup provider, no provider fits and unknown tools are said plainly", () => {
    const warnings = previewWarnings(
      preview({
        warnings: [
          { code: "NO_BACKUP_PROVIDER", tools: ["a", "b", "c", "d"] },
          { code: "NO_PROVIDER_FITS", tools: ["get_weather"] },
          { code: "IGNORED_TOOLS", tools: ["nope"] },
        ],
      }),
    );
    expect(warnings.map((w) => w.text)).toEqual([
      "4 tools have no backup provider: a, b, c and 1 more.",
      "No provider fits this agent's provider limits for get_weather.",
      "Not found, so left out: nope.",
    ]);
    expect(warnings[1]!.fix).toEqual({ kind: "open-access" });
  });

  it("a single provider is a no-backup line naming the tool", () => {
    expect(previewWarnings(preview({ warnings: [{ code: "NO_BACKUP_PROVIDER", tools: ["get_weather"] }] }))[0]!.text).toMatch(
      /^get_weather has no backup provider/,
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
    providers: [{ providerId: "p-acme", reason: "EXCLUDED_BY_AGENT", source: "AGENT", detail: "Excluded by the agent's rules" }],
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
    expect(view.layer).toBe("Refused by this agent's limits");
    expect(view.providers).toEqual([
      {
        providerId: "p-acme",
        reason: "Blocked by this agent's provider limits",
        source: "This agent's provider limits",
        fix: { kind: "include-provider", providerId: "p-acme", label: "Remove from limits" },
      },
    ]);
    expect(view.singleProviderNote).toBe("This tool has one provider, so nothing else can run it.");
  });

  it("each reason in words, with whose rule it was", () => {
    const p = (reason: string, source = "AGENT", detail = "") => providerReason({ providerId: "p", reason, source, detail });
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
          { providerId: "p1", reason: "NOT_IN_ALLOWED_PROVIDERS", source: "TOOLSET", detail: "" },
          { providerId: "p2", reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
          { providerId: "p3", reason: "BELOW_MIN_TIER", source: "AGENT", detail: "" },
        ],
      }),
    );
    expect(view.layer).toBe("Refused by the tool set's rules");
    expect(view.providers.map((p) => p.fix?.kind)).toEqual(["edit-toolset", "clear-max-price", "allow-any-tier"]);
    expect(view.singleProviderNote).toBeNull();
  });

  it("shows each fix once, however many providers it would bring back", () => {
    const view = refusedCallView(
      refused({
        providers: [
          { providerId: "p1", reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
          { providerId: "p2", reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "" },
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
    expect(server.layer).toBe("Refused by the server it called (the connection)");
    expect(server.fix).toEqual({ kind: "edit-toolset", toolsetId: "s1", label: "Add it to the tool set" });
    expect(refusedCallView(refused({ refusalCode: "MCP_SPEND_LIMIT_EXCEEDED", providers: [] })).fix).toMatchObject({ href: "/limits" });
  });

  it("says where the call came in", () => {
    expect(viaText(refused(), "twitter")).toBe("via twitter");
    expect(viaText(refused({ endpointKind: "ROOT" }))).toBe("via Everything");
    expect(viaText(refused({ endpointKind: "ROOT", viewFilter: { tools: ["get_weather"] } }))).toBe("via Only these tools");
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
