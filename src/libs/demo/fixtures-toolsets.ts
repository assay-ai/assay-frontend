import { buildMcpUrl, canonicalTools, parseMcpUrl } from "@/features/connect/mcp-url";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { ApiError } from "@/libs/ApiClient";
import type {
  AgentAccess,
  AllowedToolset,
  McpUrlPreview,
  PreviewTool,
  RefusedCall,
  ServerInUse,
  Toolset,
  ToolsetEntry,
  ToolsetEntryInput,
} from "@/services/toolsets.service";

import { demoMinutesAgo } from "./demo-clock";
import { demoConnectVariant, type DemoConnectVariant } from "./demo-connect";
import { demoProvider, demoToolOffers } from "./fixtures-explore";
import type { DemoFixture } from "./fixtures";

/**
 * DEMO ONLY — tool sets, "What this agent can use", the Connect preview,
 * Servers in use and refused calls (design spec §7.9–§7.11). The picture is
 * chosen with `?connect=` (`demo-connect.ts`).
 *
 * Every figure is derived from the same catalogue the Explorer shows
 * (`fixtures-explore.ts`): a tool's providers, their tiers and prices. So the
 * Connect sheet's "2 of 3 providers left", the per-tool result under "What
 * this agent can use" and a refused call's provider reasons all agree.
 *
 * Writes (create a tool set, edit its entries, change what an agent can use,
 * hand out a URL) are kept in memory for the page's life, like the spend
 * policy's `rememberDemoPolicy`: a stage direction so the screen answers a
 * click, not a ledger. A reload starts over.
 */

/** The buyer demo's agents (`fixtures-buyer.ts`). */
const PROD_AGENT = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const STAGING_AGENT = "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54";

/** CAIP-19 of the demo's USDG (`fixtures.ts` DEMO_ASSET), repeated to keep this file out of the import cycle. */
const ASSET = "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";

const HELIOS = "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41";
const COBALT = "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4";
const LATTICE = "48e1b60c-d573-4a92-bf08-6c3d95e12a7b";
const VERDANT = "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8";
const QUANTA = "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f";
const HARBORLIGHT = "7c1e4f6a-2b93-4d17-9f0c-5a8e31d6b204";

const RESEARCH_ID = "5f0c9b2e-7d41-4a83-b6e2-1c9a8d3f7e05";
const WEATHER_ID = "a83e6d14-2f5b-4c97-8e0a-6b1d4c2f9a37";

const TIER_RANK = { NEW: 0, ESTABLISHED: 1, TRUSTED: 2 } as const;

/** Six decimals, minor units as a string — never a float. */
function minor(major: string): string {
  const [whole, fraction = ""] = major.split(".");
  return String(BigInt(`${whole}${fraction.padEnd(6, "0").slice(0, 6)}`));
}

/** The topic a demo tool sits in (the backend's `tools.category`). */
function categoryOf(name: string): string {
  if (/weather|geocode/.test(name)) return "weather";
  if (/usd|token|market|fx|chain/.test(name)) return "finance";
  if (/wikipedia|research|summar/.test(name)) return "knowledge";
  return "web";
}

function catalogue() {
  return demoToolOffers().filter((tool) => tool.offers.length > 0 || tool.pricingMode === null);
}

function toolByName(name: string) {
  return catalogue().find((tool) => tool.name === name) ?? null;
}

function toolById(id: string) {
  return catalogue().find((tool) => tool.id === id) ?? null;
}

/* ----------------------------------------------------------- the stage */

interface AccessState {
  accessMode: "ALL" | "RESTRICTED";
  allowedToolsets: { toolsetId: string; viaUrlOnly: boolean }[];
  allowedToolIds: string[];
  excludeProviderIds: string[];
  maxPrice: string | null;
  minTier: "NEW" | "ESTABLISHED" | "TRUSTED" | null;
  policyVersion: number;
}

interface ConnectRow {
  canonicalUrl: string;
  serverName: string | null;
  client: string | null;
  handedOutAt: string | null;
  firstCallAt: string | null;
  lastCallAt: string | null;
}

interface Stage {
  variant: DemoConnectVariant;
  toolsets: Toolset[];
  access: Record<string, AccessState>;
  connect: Record<string, ConnectRow[]>;
}

let stage: Stage | null = null;

function entry(position: number, toolName: string, rule: Partial<ToolsetEntryInput> = {}): ToolsetEntry {
  const tool = toolByName(toolName)!;
  return {
    position,
    toolId: tool.id,
    toolName: tool.name,
    category: categoryOf(tool.name),
    providerMode: rule.providerMode ?? "BEST",
    providerIds: rule.providerIds ?? [],
    minTier: rule.minTier ?? null,
    maxPrice: rule.maxPrice ? { ...rule.maxPrice, decimals: 6 } : null,
    minQuality: null,
    onEmpty: rule.onEmpty ?? "FAIL",
  };
}

function toolsetRow(id: string, slug: string, name: string, description: string, entries: ToolsetEntry[], ageMinutes: number): Toolset {
  return {
    id,
    slug,
    name,
    description,
    category: entries[0]?.category ?? null,
    tags: [],
    icon: null,
    visibility: "PRIVATE",
    discovery: "AUTO",
    searchThreshold: 25,
    pinnedTools: [],
    mcpUrl: buildMcpUrl({ kind: "toolset", slug }, { free: false }, mcpHost()),
    toolCount: entries.length,
    createdAt: demoMinutesAgo(ageMinutes),
    updatedAt: demoMinutesAgo(Math.max(5, Math.floor(ageMinutes / 6))),
    entries,
  };
}

function seed(variant: DemoConnectVariant): Stage {
  const toolsets =
    variant === "empty"
      ? []
      : [
          toolsetRow(
            RESEARCH_ID,
            "research",
            "Research kit",
            "Search, read and summarise the web for the research agent.",
            [
              entry(0, "search_web", { providerMode: "ONLY", providerIds: [COBALT, LATTICE] }),
              entry(1, "extract_page_text"),
              entry(2, "search_wikipedia"),
              entry(3, "summarize_document", { onEmpty: "FALLBACK_BEST" }),
            ],
            4_320,
          ),
          toolsetRow(
            WEATHER_ID,
            "weather",
            "Weather and places",
            "Weather at a place by name: geocode first, then the forecast model.",
            [
              entry(0, "geocode_place"),
              entry(1, "get_weather", { providerMode: "EXCLUDE", providerIds: [QUANTA], minTier: "ESTABLISHED", onEmpty: "FALLBACK_BEST" }),
            ],
            1_440,
          ),
        ];
  const restricted: AccessState = {
    accessMode: "RESTRICTED",
    allowedToolsets: variant === "empty" || variant === "nothing" ? [] : [{ toolsetId: RESEARCH_ID, viaUrlOnly: true }],
    allowedToolIds:
      variant === "nothing" || variant === "empty"
        ? []
        : ["get_weather", "geocode_place", "Market quote"].map((name) => toolByName(name)!.id),
    excludeProviderIds: variant === "nothing" || variant === "empty" ? [] : [HELIOS],
    maxPrice: variant === "nothing" || variant === "empty" ? null : minor("0.005"),
    minTier: null,
    policyVersion: 6,
  };
  const everything: AccessState = {
    accessMode: "ALL",
    allowedToolsets: [],
    allowedToolIds: [],
    excludeProviderIds: [],
    maxPrice: null,
    minTier: null,
    policyVersion: 2,
  };
  const host = mcpHost();
  const prodRows: ConnectRow[] =
    variant === "empty"
      ? []
      : [
          {
            canonicalUrl: buildMcpUrl({ kind: "toolset", slug: "research" }, { free: false }, host),
            serverName: "research",
            client: "claude-code",
            handedOutAt: demoMinutesAgo(4_300),
            firstCallAt: demoMinutesAgo(4_290),
            lastCallAt: demoMinutesAgo(12),
          },
          {
            canonicalUrl: buildMcpUrl({ kind: "tools", tools: ["get_weather", "geocode_place"] }, { free: false }, host),
            serverName: "weather",
            client: "claude-code",
            handedOutAt: demoMinutesAgo(2_900),
            firstCallAt: demoMinutesAgo(2_880),
            lastCallAt: demoMinutesAgo(190),
          },
          ...(variant === "waiting"
            ? [
                {
                  canonicalUrl: buildMcpUrl({ kind: "toolset", slug: "weather" }, { free: false }, host),
                  serverName: "weather",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(3),
                  firstCallAt: null,
                  lastCallAt: null,
                },
              ]
            : []),
          ...(variant === "over-budget"
            ? [
                {
                  canonicalUrl: buildMcpUrl({ kind: "everything" }, { free: false }, host),
                  serverName: "assay",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(600),
                  firstCallAt: demoMinutesAgo(590),
                  lastCallAt: demoMinutesAgo(40),
                },
              ]
            : []),
        ];
  const stagingRows: ConnectRow[] =
    variant === "empty"
      ? []
      : [
          {
            canonicalUrl: buildMcpUrl({ kind: "everything" }, { free: false }, host),
            serverName: "assay",
            client: "claude-desktop",
            handedOutAt: demoMinutesAgo(25),
            firstCallAt: null,
            lastCallAt: null,
          },
        ];
  return {
    variant,
    toolsets,
    access: {
      [PROD_AGENT]: variant === "all" || variant === "over-budget" ? { ...everything, excludeProviderIds: [] } : restricted,
      [STAGING_AGENT]: everything,
    },
    connect: { [PROD_AGENT]: prodRows, [STAGING_AGENT]: stagingRows },
  };
}

/** The stage for the variant in force; a variant switch starts it over. */
function current(): Stage {
  const variant = demoConnectVariant();
  if (!stage || stage.variant !== variant) stage = seed(variant);
  return stage;
}

/** Back to the seeded picture — for tests. */
export function resetDemoToolsets(): void {
  stage = null;
}

function agentOf(path: string): string {
  return decodeURIComponent(path.split("/")[2] ?? "");
}

function accessOf(agentId: string): AccessState {
  const s = current();
  if (!s.access[agentId]) s.access[agentId] = { ...s.access[STAGING_AGENT]! };
  return s.access[agentId]!;
}

/* ------------------------------------------------------- the routing */

interface Fit {
  providerId: string;
  /** Null when it fits; otherwise the reason and whose rule. */
  reason: { reason: string; source: "AGENT" | "TOOLSET"; detail: string } | null;
}

/** Each provider of a tool against the agent's limits and (on its URL) the entry's rules. */
function fits(toolId: string, access: AccessState, rule: ToolsetEntry | null): Fit[] {
  const tool = toolById(toolId);
  if (!tool) return [];
  return tool.offers.map((offer) => {
    const tier = demoProvider(offer.providerId)?.tier ?? "NEW";
    const price = BigInt(minor(offer.price));
    if (rule?.providerMode === "ONLY" && !rule.providerIds.includes(offer.providerId)) {
      return { providerId: offer.providerId, reason: { reason: "NOT_IN_ALLOWED_PROVIDERS", source: "TOOLSET", detail: "Not in the entry's provider list" } };
    }
    if (rule?.providerMode === "EXCLUDE" && rule.providerIds.includes(offer.providerId)) {
      return { providerId: offer.providerId, reason: { reason: "EXCLUDED_BY_TOOLSET", source: "TOOLSET", detail: "Excluded by the entry" } };
    }
    if (access.excludeProviderIds.includes(offer.providerId)) {
      return { providerId: offer.providerId, reason: { reason: "EXCLUDED_BY_AGENT", source: "AGENT", detail: "Excluded by the agent's rules" } };
    }
    if (access.maxPrice !== null && price > BigInt(access.maxPrice)) {
      return { providerId: offer.providerId, reason: { reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: `Quote ${offer.price} above the agent's max` } };
    }
    if (rule?.maxPrice && price > BigInt(rule.maxPrice.amount)) {
      return { providerId: offer.providerId, reason: { reason: "ABOVE_MAX_PRICE", source: "TOOLSET", detail: `Quote ${offer.price} above the entry's max` } };
    }
    const minTier = [access.minTier, rule?.minTier ?? null].filter(Boolean) as ("NEW" | "ESTABLISHED" | "TRUSTED")[];
    for (const min of minTier) {
      if (TIER_RANK[tier] < TIER_RANK[min]) {
        const source = min === access.minTier ? "AGENT" : "TOOLSET";
        return { providerId: offer.providerId, reason: { reason: "BELOW_MIN_TIER", source, detail: `${tier} below ${min}` } };
      }
    }
    return { providerId: offer.providerId, reason: null };
  });
}

function standing(toolId: string, access: AccessState, s: Stage): "ALLOWED" | "VIA_TOOLSET_URL" | "BLOCKED" {
  if (access.accessMode === "ALL" || access.allowedToolIds.includes(toolId)) return "ALLOWED";
  const sets = access.allowedToolsets
    .map((ref) => ({ ref, set: s.toolsets.find((t) => t.id === ref.toolsetId) }))
    .filter(({ set }) => set?.entries.some((e) => e.toolId === toolId));
  if (sets.some(({ ref }) => !ref.viaUrlOnly)) return "ALLOWED";
  return sets.length > 0 ? "VIA_TOOLSET_URL" : "BLOCKED";
}

function accessDto(agentId: string): AgentAccess {
  const s = current();
  const access = accessOf(agentId);
  const allowedToolsets: AllowedToolset[] = access.allowedToolsets.map((ref) => {
    const set = s.toolsets.find((t) => t.id === ref.toolsetId);
    return { toolsetId: ref.toolsetId, version: null, viaUrlOnly: ref.viaUrlOnly, name: set?.name ?? null, slug: set?.slug ?? null, deleted: !set };
  });
  return {
    agentId,
    scope: "AGENT",
    policyVersion: access.policyVersion,
    accessMode: access.accessMode,
    allowedToolsets,
    allowedToolIds: [...access.allowedToolIds],
    rules: {
      excludeProviderIds: [...access.excludeProviderIds],
      maxPrice: access.maxPrice === null ? null : { amount: access.maxPrice, asset: ASSET, decimals: 6 },
      minTier: access.minTier,
      minQuality: null,
    },
    pinnedTools: [],
    tools: catalogue()
      .filter((tool) => tool.offers.length > 0)
      .map((tool) => {
        const result = fits(tool.id, access, null);
        return {
          toolId: tool.id,
          name: tool.name,
          category: categoryOf(tool.name),
          access: standing(tool.id, access, s),
          providersTotal: result.length,
          providersLeft: result.filter((f) => f.reason === null).length,
        };
      }),
  };
}

function priceDisplay(tool: ReturnType<typeof toolById>, providerIds: readonly string[]): string | null {
  if (!tool) return null;
  const prices = tool.offers.filter((o) => providerIds.includes(o.providerId)).map((o) => Number(o.price));
  if (tool.pricingMode === "FREE") return "Free";
  if (prices.length === 0) return null;
  const max = Math.max(...prices);
  const text = `$${max.toFixed(4).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
  const priced = prices.length > 1 ? `up to ${text}` : text;
  return tool.pricingMode === "FREEMIUM" ? `Free calls daily, then ${priced}` : priced;
}

function notFound(): never {
  throw new ApiError("MCP_URL_NOT_FOUND", "This MCP URL does not serve anything.", 404, "/mcp-urls/preview");
}

/** What `tools/list` would return for the agent at `url`. */
export function demoPreview(url: string, agentId: string): McpUrlPreview {
  const s = current();
  if (s.variant === "preview-error") {
    throw new ApiError("SERVICE_UNAVAILABLE", "The preview could not be computed.", 503, "/mcp-urls/preview");
  }
  const parsed = parseMcpUrl(url, mcpHost());
  if (!parsed) throw new ApiError("URL_NOT_RECOGNISED", "Not an MCP URL of this host.", 400, "/mcp-urls/preview");
  const access = accessOf(agentId);
  let toolset: Toolset | null = null;
  let inView = catalogue();
  const ignored: string[] = [];
  if (parsed.choice.kind === "toolset") {
    const slug = parsed.choice.slug;
    toolset = s.toolsets.find((t) => t.slug === slug) ?? null;
    if (!toolset) notFound();
    const ids = toolset.entries.map((e) => e.toolId);
    inView = inView.filter((tool) => ids.includes(tool.id));
  } else if (parsed.choice.kind === "tools") {
    const names = canonicalTools(parsed.choice.tools);
    for (const name of names) if (!toolByName(name)) ignored.push(name);
    inView = inView.filter((tool) => names.includes(tool.name));
  } else if (parsed.choice.kind === "url") {
    notFound();
  }
  if (parsed.options.free) inView = inView.filter((tool) => tool.pricingMode === "FREE" || tool.pricingMode === "FREEMIUM");

  const tools: PreviewTool[] = inView.map((tool) => {
    const rule = toolset?.entries.find((e) => e.toolId === tool.id) ?? null;
    const result = fits(tool.id, access, rule);
    const left = result.filter((f) => f.reason === null).map((f) => f.providerId);
    const st = standing(tool.id, access, s);
    const allowed = st === "ALLOWED" || (st === "VIA_TOOLSET_URL" && toolset !== null && access.allowedToolsets.some((r) => r.toolsetId === toolset!.id));
    const noProviderFits = tool.offers.length > 0 && left.length === 0;
    const fallback = noProviderFits && rule?.onEmpty === "FALLBACK_BEST";
    return {
      toolId: tool.id,
      name: tool.name,
      category: categoryOf(tool.name),
      listed: allowed && tool.offers.length > 0,
      allowed,
      pricingMode: (tool.pricingMode as PreviewTool["pricingMode"]) ?? null,
      price: noProviderFits && !fallback ? null : priceDisplay(tool, fallback ? tool.offers.map((o) => o.providerId) : left),
      providerCount: tool.offers.length,
      noProviderFits: noProviderFits && !fallback,
    };
  });
  const listed = tools.filter((t) => t.listed);
  const warnings: McpUrlPreview["warnings"] = [];
  const add = (code: string, list: string[]) => {
    if (list.length > 0) warnings.push({ code, tools: list });
  };
  add("NO_BACKUP_PROVIDER", listed.filter((t) => t.providerCount === 1).map((t) => t.name));
  add("BLOCKED_BY_ACCESS", tools.filter((t) => !t.allowed).map((t) => t.name));
  add("NO_PROVIDER_FITS", tools.filter((t) => t.allowed && t.noProviderFits).map((t) => t.name));
  if (tools.length > 0 && !tools.some((t) => t.allowed)) warnings.push({ code: "NOTHING_ALLOWED", tools: [] });
  add("IGNORED_TOOLS", ignored);
  const canonicalUrl = buildMcpUrl(parsed.choice, parsed.options, mcpHost());
  return {
    canonicalUrl,
    endpointKind: toolset ? "TOOLSET" : "ROOT",
    toolsetId: toolset?.id ?? null,
    toolsetName: toolset?.name ?? null,
    viewFilter:
      parsed.choice.kind === "tools" || parsed.options.free
        ? {
            ...(parsed.choice.kind === "tools" ? { tools: canonicalTools(parsed.choice.tools) } : {}),
            ...(parsed.options.free ? { free: true } : {}),
          }
        : null,
    discovery: "FULL",
    listedCount: listed.length,
    // About 230 tokens per tool definition (name, summary, price line, input schema).
    estimatedTokens: listed.reduce((sum, t) => sum + 210 + t.name.length * 2, 0),
    freeOnly: parsed.options.free,
    tools,
    ignoredTools: ignored,
    warnings,
  };
}

function serversOf(agentId: string): { servers: ServerInUse[]; overBudget: boolean } {
  const s = current();
  const rows = s.connect[agentId] ?? [];
  const servers = rows.map((row): ServerInUse => {
    let preview: McpUrlPreview | null = null;
    try {
      preview = s.variant === "preview-error" ? null : demoPreview(row.canonicalUrl, agentId);
    } catch {
      preview = null;
    }
    const parsed = parseMcpUrl(row.canonicalUrl, mcpHost());
    const toolset = parsed?.choice.kind === "toolset" ? s.toolsets.find((t) => t.slug === (parsed.choice as { slug: string }).slug) : null;
    return {
      canonicalUrl: row.canonicalUrl,
      endpointKind: toolset ? "TOOLSET" : "ROOT",
      toolsetId: toolset?.id ?? null,
      name: preview?.toolsetName ?? row.serverName ?? "assay",
      serverName: row.serverName,
      client: row.client,
      toolCount: preview ? preview.listedCount : null,
      estimatedTokens: preview ? preview.estimatedTokens : null,
      discovery: "FULL",
      lastCallAt: row.lastCallAt,
      handedOutAt: row.handedOutAt,
      firstCallAt: row.firstCallAt,
      waitingForFirstCall: row.handedOutAt !== null && !row.firstCallAt && !row.lastCallAt,
      available: s.variant === "preview-error" ? true : preview !== null,
      updateAvailable: false,
    };
  });
  // The over-budget picture's `/` lists the whole catalogue for an agent that can use everything.
  const total = servers.reduce((sum, server) => sum + (server.toolCount ?? 0), 0);
  return { servers, overBudget: total > 25 || s.variant === "over-budget" };
}

/* ----------------------------------------------------- refused calls */

function refusedCalls(): RefusedCall[] {
  const s = current();
  if (s.variant === "empty") return [];
  const research = s.toolsets.find((t) => t.id === RESEARCH_ID);
  const access = accessOf(PROD_AGENT);
  const reasons = (toolName: string, rule: ToolsetEntry | null) =>
    fits(toolByName(toolName)!.id, access, rule)
      .filter((f) => f.reason !== null)
      .map((f) => ({ providerId: f.providerId, ...f.reason! }));
  const marketQuote: RefusedCall = {
    callId: "rc-7f3a91d2-market-quote",
    agentId: PROD_AGENT,
    toolId: toolByName("Market quote")!.id,
    toolName: "Market quote",
    refusalCode: "NO_PROVIDER_MATCHES_RULES",
    refusalLayer: "AGENT_LIMITS",
    charged: false,
    // One provider, above the agent's max: "This tool has one provider".
    providers: [{ providerId: HARBORLIGHT, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "Quote 0.45 above the agent's max" }],
    endpointKind: "ROOT",
    toolsetId: null,
    toolsetVersion: null,
    viewFilter: null,
    createdAt: demoMinutesAgo(18),
  };
  if (s.variant === "single") return [marketQuote];
  const searchRule = research?.entries.find((e) => e.toolName === "search_web") ?? null;
  const searchReasons = reasons("search_web", searchRule);
  return [
    {
      callId: "rc-2b8e40c7-search-web",
      agentId: PROD_AGENT,
      toolId: toolByName("search_web")!.id,
      toolName: "search_web",
      refusalCode: "NO_PROVIDER_MATCHES_RULES",
      refusalLayer: searchReasons.some((r) => r.source === "AGENT") ? "AGENT_LIMITS" : "TOOLSET_RULES",
      charged: false,
      providers:
        searchReasons.length > 0
          ? searchReasons
          : [{ providerId: COBALT, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "Quote 0.0080 above the agent's max" }],
      endpointKind: "TOOLSET",
      toolsetId: RESEARCH_ID,
      toolsetVersion: null,
      viewFilter: null,
      createdAt: demoMinutesAgo(7),
    },
    marketQuote,
    {
      callId: "rc-c41d9e05-token-market",
      agentId: PROD_AGENT,
      toolId: toolByName("get_token_market")!.id,
      toolName: "get_token_market",
      refusalCode: "TOOL_NOT_ALLOWED",
      refusalLayer: "AGENT_LIMITS",
      charged: false,
      providers: [],
      endpointKind: "ROOT",
      toolsetId: null,
      toolsetVersion: null,
      viewFilter: null,
      createdAt: demoMinutesAgo(64),
    },
    {
      callId: "rc-9a06f2b8-scrape-url",
      agentId: PROD_AGENT,
      toolId: toolByName("scrape_url")!.id,
      toolName: "scrape_url",
      refusalCode: "TOOL_NOT_IN_TOOLSET",
      refusalLayer: "SERVER",
      charged: false,
      providers: [],
      endpointKind: "TOOLSET",
      toolsetId: RESEARCH_ID,
      toolsetVersion: null,
      viewFilter: null,
      createdAt: demoMinutesAgo(150),
    },
  ];
}

/* ------------------------------------------------------- the writes */

function newId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function entriesFrom(input: unknown): ToolsetEntry[] {
  const list = Array.isArray(input) ? (input as ToolsetEntryInput[]) : [];
  return list
    .map((e, position) => {
      const tool = toolById(e.toolId);
      if (!tool) return null;
      return {
        position,
        toolId: tool.id,
        toolName: tool.name,
        category: categoryOf(tool.name),
        providerMode: e.providerMode ?? "BEST",
        providerIds: e.providerIds ?? [],
        minTier: e.minTier ?? null,
        maxPrice: e.maxPrice ? { amount: e.maxPrice.amount, asset: e.maxPrice.asset, decimals: 6 } : null,
        minQuality: e.minQuality ?? null,
        onEmpty: e.onEmpty ?? "FAIL",
      } satisfies ToolsetEntry;
    })
    .filter((e): e is ToolsetEntry => e !== null);
}

function slugTaken(slug: string, exceptId?: string): never | void {
  if (current().toolsets.some((t) => t.slug === slug && t.id !== exceptId)) {
    throw new ApiError("TOOLSET_SLUG_TAKEN", "The slug is already used by another of your tool sets", 409, "/toolsets", {
      slug,
      suggestion: `${slug}-2`,
    });
  }
}

function slugOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug.length >= 2 ? slug : `${slug || "set"}-1`;
}

function requireToolset(path: string): Toolset {
  const id = decodeURIComponent(path.split("/")[2] ?? "");
  const set = current().toolsets.find((t) => t.id === id);
  if (!set) throw new ApiError("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
  return set;
}

function touch(set: Toolset, patch: Partial<Toolset>): Toolset {
  const next = { ...set, ...patch, updatedAt: new Date().toISOString() };
  next.toolCount = next.entries.length;
  next.mcpUrl = buildMcpUrl({ kind: "toolset", slug: next.slug }, { free: false }, mcpHost());
  const s = current();
  s.toolsets = s.toolsets.map((t) => (t.id === set.id ? next : t));
  return next;
}

function page<T>(items: T[]) {
  return { items, pageInfo: { nextCursor: null, hasMore: false } };
}

export const TOOLSET_FIXTURES: readonly DemoFixture[] = [
  {
    method: "GET",
    match: "/toolsets",
    body: () => page(current().toolsets.map(({ entries: _entries, ...summary }) => summary)),
  },
  {
    method: "POST",
    match: "/toolsets",
    body: (_path, _query, data) => {
      const name = String(data?.name ?? "").trim() || "My tool set";
      const slug = typeof data?.slug === "string" && data.slug ? data.slug : slugOf(name);
      slugTaken(slug);
      const set = toolsetRow(newId(), slug, name, String(data?.description ?? ""), entriesFrom(data?.entries), 0);
      set.createdAt = new Date().toISOString();
      set.updatedAt = set.createdAt;
      current().toolsets = [set, ...current().toolsets];
      return set;
    },
  },
  {
    method: "PUT",
    match: /^\/toolsets\/[^/]+\/entries$/,
    body: (path, _query, data) => touch(requireToolset(path), { entries: entriesFrom(data?.entries) }),
  },
  {
    method: "GET",
    match: /^\/toolsets\/[^/]+$/,
    body: (path) => requireToolset(path),
  },
  {
    method: "PATCH",
    match: /^\/toolsets\/[^/]+$/,
    body: (path, _query, data) => {
      const set = requireToolset(path);
      const patch: Partial<Toolset> = {};
      if (typeof data?.name === "string") patch.name = data.name.trim() || set.name;
      if (typeof data?.slug === "string") {
        slugTaken(data.slug, set.id);
        patch.slug = data.slug;
      }
      if (data && "description" in data) patch.description = (data.description as string | null) ?? null;
      return touch(set, patch);
    },
  },
  {
    method: "DELETE",
    match: /^\/toolsets\/[^/]+$/,
    body: (path) => {
      const set = requireToolset(path);
      const s = current();
      s.toolsets = s.toolsets.filter((t) => t.id !== set.id);
      return null;
    },
  },
  {
    method: "POST",
    match: /^\/agents\/[^/]+\/access\/only-connected$/,
    body: (path) => {
      const agentId = agentOf(path);
      const s = current();
      const access = accessOf(agentId);
      let everything = false;
      const sets: { toolsetId: string; viaUrlOnly: boolean }[] = [];
      const ids = new Set<string>();
      for (const row of s.connect[agentId] ?? []) {
        const parsed = parseMcpUrl(row.canonicalUrl, mcpHost());
        if (!parsed) continue;
        if (parsed.choice.kind === "everything") everything = true;
        if (parsed.choice.kind === "tools") for (const name of parsed.choice.tools) if (toolByName(name)) ids.add(toolByName(name)!.id);
        if (parsed.choice.kind === "toolset") {
          const slug = parsed.choice.slug;
          const set = s.toolsets.find((t) => t.slug === slug);
          if (set && !sets.some((r) => r.toolsetId === set.id)) sets.push({ toolsetId: set.id, viaUrlOnly: true });
        }
      }
      s.access[agentId] = everything
        ? { ...access, accessMode: "ALL", policyVersion: access.policyVersion + 1 }
        : { ...access, accessMode: "RESTRICTED", allowedToolsets: sets, allowedToolIds: [...ids], policyVersion: access.policyVersion + 1 };
      return { ...accessDto(agentId), everything };
    },
  },
  {
    method: "GET",
    match: /^\/agents\/[^/]+\/access$/,
    body: (path) => accessDto(agentOf(path)),
  },
  {
    method: "PATCH",
    match: /^\/agents\/[^/]+\/access$/,
    body: (path, _query, data) => {
      const agentId = agentOf(path);
      const access = accessOf(agentId);
      const body = data ?? {};
      const rules = (body.rules ?? {}) as Record<string, unknown>;
      const next: AccessState = { ...access, policyVersion: access.policyVersion + 1 };
      if (body.accessMode === "ALL" || body.accessMode === "RESTRICTED") next.accessMode = body.accessMode;
      if (Array.isArray(body.allowedToolsets)) {
        next.allowedToolsets = (body.allowedToolsets as { toolsetId: string; viaUrlOnly?: boolean }[]).map((r) => ({
          toolsetId: r.toolsetId,
          viaUrlOnly: r.viaUrlOnly !== false,
        }));
      }
      if (Array.isArray(body.allowedToolIds)) next.allowedToolIds = [...new Set(body.allowedToolIds as string[])];
      if (Array.isArray(rules.excludeProviderIds)) next.excludeProviderIds = [...new Set(rules.excludeProviderIds as string[])];
      if ("maxPrice" in rules) next.maxPrice = (rules.maxPrice as string | null) ?? null;
      if ("minTier" in rules) next.minTier = (rules.minTier as AccessState["minTier"]) ?? null;
      current().access[agentId] = next;
      return accessDto(agentId);
    },
  },
  {
    method: "POST",
    match: "/mcp-urls/preview",
    body: (_path, _query, data) => demoPreview(String(data?.url ?? ""), String(data?.agentId ?? PROD_AGENT)),
  },
  {
    method: "GET",
    match: /^\/agents\/[^/]+\/servers$/,
    body: (path) => serversOf(agentOf(path)),
  },
  {
    method: "POST",
    match: /^\/agents\/[^/]+\/connect-urls$/,
    body: (path, _query, data) => {
      const agentId = agentOf(path);
      const s = current();
      const parsed = parseMcpUrl(String(data?.url ?? ""), mcpHost());
      if (!parsed) throw new ApiError("URL_NOT_RECOGNISED", "Not an MCP URL of this host.", 400, path);
      const canonicalUrl = buildMcpUrl(parsed.choice, parsed.options, mcpHost());
      const rows = s.connect[agentId] ?? [];
      const existing = rows.find((row) => row.canonicalUrl === canonicalUrl);
      const row: ConnectRow = existing
        ? { ...existing, serverName: (data?.serverName as string) ?? existing.serverName, client: (data?.client as string) ?? existing.client }
        : {
            canonicalUrl,
            serverName: (data?.serverName as string) ?? null,
            client: (data?.client as string) ?? null,
            handedOutAt: new Date().toISOString(),
            firstCallAt: null,
            lastCallAt: null,
          };
      s.connect[agentId] = [row, ...rows.filter((r) => r.canonicalUrl !== canonicalUrl)];
      return serversOf(agentId).servers.find((server) => server.canonicalUrl === canonicalUrl);
    },
  },
  {
    method: "GET",
    match: "/refused-calls",
    body: (_path, query) => {
      const agentId = typeof query.agentId === "string" ? query.agentId : null;
      return page(refusedCalls().filter((call) => !agentId || call.agentId === agentId));
    },
  },
  {
    method: "GET",
    match: /^\/refused-calls\/[^/]+$/,
    body: (path) => {
      const id = decodeURIComponent(path.split("/")[2] ?? "");
      const call = refusedCalls().find((c) => c.callId === id);
      if (!call) throw new ApiError("TOOLSET_REFUSED_CALL_NOT_FOUND", "Refused call not found", 404, path);
      return call;
    },
  },
];
