import { buildMcpUrl, canonicalTools, parseMcpUrl, type ConnectChoice } from "@/features/connect/mcp-url";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { changelogFrom, diffSnapshots, HANDLE_RE, normaliseHandle, snapshotOfDraft, type Snapshot } from "@/features/toolsets/sharing";
import { ApiError } from "@/libs/ApiClient";
import type { PublicCategory, PublicToolsetCard, PublicToolsetPage } from "@/services/public-toolsets.service";
import type {
  AgentAccess,
  AllowedToolset,
  McpUrlPreview,
  PreviewTool,
  PublishResult,
  RefusedCall,
  ServerInUse,
  Toolset,
  ToolsetEntry,
  ToolsetEntryInput,
  ToolsetOwnStats,
  ToolsetUrls,
  ToolsetVersion,
  ToolsetVisibility,
} from "@/services/toolsets.service";

import { demoMinutesAgo } from "./demo-clock";
import { demoConnectVariant, type DemoConnectVariant } from "./demo-connect";
import { demoCategoryOf, demoProvider, demoToolOffers } from "./fixtures-explore";
import {
  DEMO_PUBLIC_SETS,
  demoPublicVersionDetail,
  demoPublicCard,
  demoPublicPage,
  demoPublicVersions,
  demoSetAgeMinutes,
  demoToolIdOf,
  demoWeekStart,
  type DemoPublicSet,
} from "./fixtures-public-toolsets";
import type { DemoFixture } from "./fixtures";
import { demoContractVersions } from "./fixtures-contracts";
import { contractRefusedCalls } from "./fixtures-refusals-contracts";

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
const NORTHWIND = "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62";
const HARBORLIGHT = "7c1e4f6a-2b93-4d17-9f0c-5a8e31d6b204";

const RESEARCH_ID = "5f0c9b2e-7d41-4a83-b6e2-1c9a8d3f7e05";
const WEATHER_ID = "a83e6d14-2f5b-4c97-8e0a-6b1d4c2f9a37";
/** The tool set the contract notices name: it routes get_weather to v1 (T3). */
export const DEMO_WEATHER_TOOLSET = { id: WEATHER_ID, name: "Weather and places" } as const;

const TIER_RANK = { NEW: 0, ESTABLISHED: 1, TRUSTED: 2 } as const;

/** The demo account's public name, once claimed. */
export const DEMO_OWN_HANDLE = "brightpath";
const RESEARCH_TOKEN = "r8m2x5k9q1w4z7n3p6t0ab";
const WEATHER_TOKEN = "k7q2m9x4p1w8z3n6r5t0vb";
/** @marketkit/desk-tools, shared by link only. */
const DESK_TOKEN = DEMO_PUBLIC_SETS.find((x) => x.slug === "desk-tools")!.unlistedToken!;
/** @marketkit/crypto-research: "prod" is locked to v2 in `update-available`. */
const MARKETKIT_SET = DEMO_PUBLIC_SETS.find((x) => x.ownerHandle === "marketkit" && x.slug === "crypto-research")!;
const DAY = 1_440;
const SHARED_VARIANTS: readonly DemoConnectVariant[] = ["shared", "unlisted", "update-available", "delisted", "stopped", "removed"];
/** `delisted`, `stopped`, `removed`: "prod" is also locked to another team's set in that state. */
const FOREIGN_STATE: Partial<Record<DemoConnectVariant, { set: DemoPublicSet; status: "DELETED" | "NOT_SHARED" | "REMOVED" }>> = {
  delisted: { set: DEMO_PUBLIC_SETS.find((x) => x.slug === "travel-planner")!, status: "DELETED" },
  stopped: { set: DEMO_PUBLIC_SETS.find((x) => x.slug === "news-digest")!, status: "NOT_SHARED" },
  removed: { set: DEMO_PUBLIC_SETS.find((x) => x.slug === "fast-search")!, status: "REMOVED" },
};
/** Handles other organizations hold in the demo. */
const TAKEN_HANDLES = new Set(DEMO_PUBLIC_SETS.map((x) => x.ownerHandle));

/** Six decimals, minor units as a string — never a float. */
function minor(major: string): string {
  const [whole, fraction = ""] = major.split(".");
  return String(BigInt(`${whole}${fraction.padEnd(6, "0").slice(0, 6)}`));
}

const categoryOf = demoCategoryOf;

function catalogue() {
  return demoToolOffers().filter((tool) => tool.offers.length > 0 || tool.pricingMode === null);
}

/** A tool by its name, or by its id — the name a `?tools=` URL uses when the display name is not an MCP name. */
function toolByName(name: string) {
  return catalogue().find((tool) => tool.name === name || tool.id === name) ?? null;
}

function toolById(id: string) {
  return catalogue().find((tool) => tool.id === id) ?? null;
}

/* ----------------------------------------------------------- the stage */

interface AccessState {
  accessMode: "ALL" | "RESTRICTED";
  /** `version` null follows the latest (own and Official only). */
  /** `status`: how another organization's tool set stands now (demo pictures delisted, stopped, removed). */
  allowedToolsets: { toolsetId: string; viaUrlOnly: boolean; version: number | null; status?: "ACTIVE" | "DELETED" | "NOT_SHARED" | "REMOVED" }[];
  pinnedTools: string[];
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
  /** Published versions per tool set, newest first. */
  versions: Record<string, ToolsetVersion[]>;
  access: Record<string, AccessState>;
  connect: Record<string, ConnectRow[]>;
  handle: string | null;
  /** Public names the last "taken" answer suggested: claiming one works. */
  suggested: string[];
  reports: Set<string>;
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
    // T3: a new entry routes to the tool's current major, as the server stores it.
    toolVersionRange: rule.toolVersionRange ?? currentRangeOf(tool.id),
    requireOutputFields: rule.requireOutputFields ?? [],
  };
}

/** "^2" — the range a new entry gets: the tool's current major. */
function currentRangeOf(toolId: string): string | null {
  const current = demoContractVersions(toolId).find((v) => v.isCurrent);
  return current ? `^${current.major}` : null;
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
    publisherKind: "USER",
    handle: null,
    listingStatus: null,
    latestVersion: null,
    sharingEndsAt: null,
    delisted: false,
    removed: false,
    unlistedToken: null,
    forkedFrom: null,
    entries,
  };
}

/** A version snapshot of entries, as `GET /toolsets/:id/versions/:v` answers. */
function versionOf(set: Toolset, version: number, entries: ToolsetEntry[], ageMinutes: number, changelog: string): ToolsetVersion {
  return {
    version,
    publishedAt: demoMinutesAgo(ageMinutes),
    changelog,
    name: set.name,
    toolCount: entries.length,
    description: set.description,
    icon: set.icon,
    discovery: "AUTO",
    searchThreshold: 25,
    pinnedTools: [],
    entries: entries.map((e) => ({
      toolId: e.toolId,
      toolName: e.toolName,
      providerMode: e.providerMode,
      providerIds: [...e.providerIds],
      minTier: e.minTier,
      maxPrice: e.maxPrice,
      minQuality: e.minQuality,
      onEmpty: e.onEmpty,
      toolVersionRange: e.toolVersionRange ?? null,
      requireOutputFields: [...(e.requireOutputFields ?? [])],
    })),
  };
}

/** The URLs the backend computes from the sharing state (`ToolsetUrlsDto`). */
function urlsOf(set: Toolset, handle: string | null): ToolsetUrls {
  const host = mcpHost();
  const draft = `${host}/my/${set.slug}`;
  const v = set.latestVersion ?? null;
  const shared = set.visibility !== "PRIVATE" && !set.removed;
  const pub = shared && set.visibility === "PUBLIC" && handle && !set.delisted ? `${host}/@${handle}/${set.slug}` : null;
  const unlisted = shared && set.unlistedToken ? `${host}/u/${set.unlistedToken}` : null;
  return {
    draft,
    myPinned: v ? `${draft}@${v}` : null,
    public: pub,
    publicPinned: pub && v ? `${pub}@${v}` : null,
    unlisted,
    unlistedPinned: unlisted && v ? `${unlisted}@${v}` : null,
  };
}

/** A tool set as the API answers it: its public name and URLs from the current state. */
function dto(set: Toolset): Toolset {
  const handle = current().handle;
  return { ...set, handle, urls: urlsOf(set, handle), mcpUrl: `${mcpHost()}/my/${set.slug}` };
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
              entry(1, "get_weather", {
                providerMode: "EXCLUDE",
                providerIds: [QUANTA],
                minTier: "ESTABLISHED",
                onEmpty: "FALLBACK_BEST",
                // T3: built for v1 and its uv_index; v1 is deprecated, so the row says so and offers "Allow v2".
                toolVersionRange: "^1",
                requireOutputFields: ["uv_index"],
              }),
            ],
            1_440,
          ),
        ];
  const versions: Record<string, ToolsetVersion[]> = {};
  const research = toolsets.find((t) => t.id === RESEARCH_ID);
  const weather = toolsets.find((t) => t.id === WEATHER_ID);
  if (weather) {
    weather.latestVersion = 1;
    versions[WEATHER_ID] = [versionOf(weather, 1, weather.entries, 7 * DAY, "First version: 2 tools.")];
    if (variant === "shared") {
      weather.visibility = "UNLISTED";
      weather.unlistedToken = WEATHER_TOKEN;
    }
  }
  if (research && SHARED_VARIANTS.includes(variant)) {
    const [search, extract, wiki, summary] = research.entries as [ToolsetEntry, ToolsetEntry, ToolsetEntry, ToolsetEntry];
    const v1 = versionOf(research, 1, [{ ...search, providerMode: "BEST", providerIds: [] }, extract], 20 * DAY, "First version: 2 tools.");
    const v2 = versionOf(research, 2, [{ ...search, providerMode: "BEST", providerIds: [] }, extract, wiki], 10 * DAY, "Added search_wikipedia.");
    // v3 stops summarize_document when no provider fits; the Draft has since let Assay pick.
    const v3 = versionOf(research, 3, [search, extract, wiki, { ...summary, onEmpty: "FAIL" }], 3 * DAY, "Added summarize_document. Changed provider rules for search_web.");
    const upTo = variant === "unlisted" ? 2 : 3;
    versions[RESEARCH_ID] = [v3, v2, v1].filter((v) => v.version <= upTo);
    research.latestVersion = upTo;
    if (variant === "unlisted") {
      research.visibility = "UNLISTED";
      research.unlistedToken = RESEARCH_TOKEN;
    } else if (variant === "stopped") {
      research.visibility = "PRIVATE";
      research.unlistedToken = RESEARCH_TOKEN;
      research.sharingEndsAt = demoMinutesAgo(-80 * DAY);
    } else {
      research.visibility = "PUBLIC";
      research.listingStatus = variant === "delisted" ? "DELISTED" : "LISTED";
      research.delisted = variant === "delisted";
      research.removed = variant === "removed";
      research.sharingEndsAt = variant === "delisted" ? demoMinutesAgo(-88 * DAY) : null;
    }
  }
  const restricted: AccessState = {
    accessMode: "RESTRICTED",
    allowedToolsets:
      variant === "empty" || variant === "nothing"
        ? []
        : [
            { toolsetId: RESEARCH_ID, viaUrlOnly: true, version: null },
            ...(variant === "update-available" ? [{ toolsetId: MARKETKIT_SET.id, viaUrlOnly: true, version: 2 }] : []),
            // Another team's tool set this agent is locked to, in the state the picture is about.
            ...(FOREIGN_STATE[variant] ? [{ toolsetId: FOREIGN_STATE[variant]!.set.id, viaUrlOnly: true, version: 1, status: FOREIGN_STATE[variant]!.status }] : []),
          ],
    pinnedTools: [],
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
    pinnedTools: [],
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
                  // Handed out by the first run (/connect), no call yet.
                  canonicalUrl: buildMcpUrl({ kind: "everything" }, { free: false }, host),
                  serverName: "assay",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(3),
                  firstCallAt: null,
                  lastCallAt: null,
                },
              ]
            : []),
          ...(variant === "update-available"
            ? [
                {
                  canonicalUrl: `${host}/@marketkit/crypto-research@2`,
                  serverName: "crypto",
                  client: "claude-code",
                  handedOutAt: demoMinutesAgo(30 * DAY),
                  firstCallAt: demoMinutesAgo(30 * DAY - 10),
                  lastCallAt: demoMinutesAgo(45),
                },
              ]
            : []),
          ...(variant === "over-budget"
            ? [
                // Everything set to show every tool (13 tools) + the weather tool set (2) + six chosen
                // tools, on top of the 4 + 2 above: 27 tools shown in full, over the 25 budget.
                {
                  canonicalUrl: buildMcpUrl({ kind: "everything" }, { free: false, discovery: "full" }, host),
                  serverName: "assay",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(600),
                  firstCallAt: demoMinutesAgo(590),
                  lastCallAt: demoMinutesAgo(40),
                },
                {
                  canonicalUrl: buildMcpUrl({ kind: "toolset", slug: "weather" }, { free: false }, host),
                  serverName: "weather2",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(500),
                  firstCallAt: demoMinutesAgo(490),
                  lastCallAt: demoMinutesAgo(55),
                },
                {
                  canonicalUrl: buildMcpUrl(
                    { kind: "tools", tools: ["get_weather", "geocode_place", "search_web", "extract_page_text", "get_usd_eur_rate", "get_token_market"] },
                    { free: false },
                    host,
                  ),
                  serverName: "tools",
                  client: "cursor",
                  handedOutAt: demoMinutesAgo(400),
                  firstCallAt: demoMinutesAgo(390),
                  lastCallAt: demoMinutesAgo(70),
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
          {
            // A link-only set from another team, holding a third maker's link-only tool (cobalt__news_search):
            // its page (#token=) shows "Not reviewed" and what "Make my own version" leaves behind.
            canonicalUrl: buildMcpUrl({ kind: "link", token: DESK_TOKEN, version: 1 }, { free: false }, host),
            serverName: "desk",
            client: "claude-desktop",
            handedOutAt: demoMinutesAgo(9 * DAY),
            firstCallAt: demoMinutesAgo(9 * DAY - 20),
            lastCallAt: demoMinutesAgo(300),
          },
        ];
  return {
    variant,
    toolsets,
    versions,
    handle: SHARED_VARIANTS.includes(variant) ? DEMO_OWN_HANDLE : null,
    suggested: [],
    reports: new Set(),
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

/** The tool ids an allowed tool set holds: one of ours, or a public one at its locked version. */
function toolIdsOfSet(toolsetId: string, s: Stage): string[] {
  const own = s.toolsets.find((t) => t.id === toolsetId);
  if (own) return own.entries.map((e) => e.toolId);
  const pub = DEMO_PUBLIC_SETS.find((x) => x.id === toolsetId);
  return pub ? pub.tools.map((t) => demoToolIdOf(pub, t.name)) : [];
}

function standing(toolId: string, access: AccessState, s: Stage): "ALLOWED" | "VIA_TOOLSET_URL" | "BLOCKED" {
  if (access.accessMode === "ALL" || access.allowedToolIds.includes(toolId)) return "ALLOWED";
  const sets = access.allowedToolsets
    .filter((ref) => ref.status !== "REMOVED")
    .map((ref) => ({ ref, ids: toolIdsOfSet(ref.toolsetId, s) }))
    .filter(({ ids }) => ids.includes(toolId));
  if (sets.some(({ ref }) => !ref.viaUrlOnly)) return "ALLOWED";
  return sets.length > 0 ? "VIA_TOOLSET_URL" : "BLOCKED";
}

function accessDto(agentId: string): AgentAccess {
  const s = current();
  const access = accessOf(agentId);
  const allowedToolsets: AllowedToolset[] = access.allowedToolsets.map((ref) => {
    const set = s.toolsets.find((t) => t.id === ref.toolsetId);
    const pub = DEMO_PUBLIC_SETS.find((x) => x.id === ref.toolsetId);
    if (!set && pub) {
      return {
        toolsetId: ref.toolsetId,
        version: ref.version,
        viaUrlOnly: ref.viaUrlOnly,
        name: pub.name,
        slug: pub.slug,
        deleted: ref.status === "DELETED",
        handle: pub.ownerHandle,
        own: false,
        status: ref.status ?? "ACTIVE",
        latestVersion: ref.status && ref.status !== "ACTIVE" ? null : pub.versions[0]!.version,
      };
    }
    return {
      toolsetId: ref.toolsetId,
      version: ref.version,
      viaUrlOnly: ref.viaUrlOnly,
      name: set?.name ?? null,
      slug: set?.slug ?? null,
      deleted: !set,
      handle: s.handle,
      own: true,
      status: !set ? "DELETED" : set.removed ? "REMOVED" : "ACTIVE",
      latestVersion: set?.latestVersion ?? null,
    };
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
    pinnedTools: [...access.pinnedTools],
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

/** A public or link-only set an MCP URL names: the catalogue's, or one of ours while shared. */
function sharedSetOf(choice: ConnectChoice, s: Stage): { id: string; name: string; toolIds: string[]; latest: number } | null {
  if (choice.kind === "shared") {
    const pub = DEMO_PUBLIC_SETS.find((x) => !x.unlistedToken && x.ownerHandle === choice.handle && x.slug === choice.slug);
    if (pub) return { id: pub.id, name: pub.name, toolIds: pub.tools.map((t) => demoToolIdOf(pub, t.name)), latest: pub.versions[0]!.version };
    const own = s.toolsets.find((t) => t.slug === choice.slug && s.handle === choice.handle && t.visibility === "PUBLIC" && !t.removed);
    return own ? { id: own.id, name: own.name, toolIds: own.entries.map((e) => e.toolId), latest: own.latestVersion ?? 1 } : null;
  }
  if (choice.kind === "link") {
    const pub = DEMO_PUBLIC_SETS.find((x) => x.unlistedToken === choice.token);
    if (pub) return { id: pub.id, name: pub.name, toolIds: pub.tools.map((t) => demoToolIdOf(pub, t.name)), latest: pub.versions[0]!.version };
    const own = s.toolsets.find((t) => t.unlistedToken === choice.token && !t.removed);
    return own ? { id: own.id, name: own.name, toolIds: own.entries.map((e) => e.toolId), latest: own.latestVersion ?? 1 } : null;
  }
  return null;
}

/** Search mode lists the always-loaded tools and these three. */
const META_TOOLS = ["search_tools", "get_tool", "call_tool"];

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
  let shared: ReturnType<typeof sharedSetOf> = null;
  let inView = catalogue();
  const ignored: string[] = [];
  const choice = parsed.choice;
  if (choice.kind === "toolset") {
    toolset = s.toolsets.find((t) => t.slug === choice.slug) ?? null;
    if (!toolset) notFound();
    let ids = toolset.entries.map((e) => e.toolId);
    if (choice.version) {
      const version = s.versions[toolset.id]?.find((v) => v.version === choice.version);
      if (!version) notFound();
      ids = version.entries.map((e) => e.toolId);
    }
    inView = inView.filter((tool) => ids.includes(tool.id));
  } else if (choice.kind === "shared" || choice.kind === "link") {
    shared = sharedSetOf(choice, s);
    if (!shared || (choice.version && choice.version > shared.latest)) notFound();
    const ids = shared.toolIds;
    inView = inView.filter((tool) => ids.includes(tool.id));
  } else if (choice.kind === "topic") {
    inView = inView.filter((tool) => categoryOf(tool.name) === choice.category);
    if (inView.length === 0) notFound();
  } else if (choice.kind === "tools") {
    const names = canonicalTools(choice.tools);
    for (const name of names) if (!toolByName(name)) ignored.push(name);
    inView = inView.filter((tool) => names.includes(tool.name) || names.includes(tool.id));
  } else if (choice.kind === "url" || choice.kind === "maker") {
    // A maker serves its own provider tools, which arrive in a later phase.
    notFound();
  }
  if (parsed.options.free) inView = inView.filter((tool) => tool.pricingMode === "FREE" || tool.pricingMode === "FREEMIUM");

  const viaThisSet = (st: string) =>
    st === "VIA_TOOLSET_URL" &&
    ((toolset !== null && access.allowedToolsets.some((r) => r.toolsetId === toolset!.id)) ||
      (shared !== null && access.allowedToolsets.some((r) => r.toolsetId === shared!.id)));
  const tools: PreviewTool[] = inView.map((tool) => {
    const rule = toolset?.entries.find((e) => e.toolId === tool.id) ?? null;
    const result = fits(tool.id, access, rule);
    const left = result.filter((f) => f.reason === null).map((f) => f.providerId);
    const st = standing(tool.id, access, s);
    // A public set the agent may not use otherwise: its tools are allowed on its own URL only when access allows the set.
    const allowed = st === "ALLOWED" || viaThisSet(st);
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
      // The demo's providers all settle on the buyer's chain and take calls, so only the rules empty a tool.
      noFitReason: noProviderFits && !fallback ? ("RULES" as const) : null,
    };
  });
  const listed = tools.filter((t) => t.listed);
  const warnings: McpUrlPreview["warnings"] = [];
  const ref = (t: PreviewTool) => ({ toolId: t.toolId, name: t.name });
  const add = (code: string, list: { toolId: string | null; name: string }[]) => {
    if (list.length > 0) warnings.push({ code, tools: list });
  };
  add("NO_BACKUP_PROVIDER", listed.filter((t) => t.providerCount === 1).map(ref));
  add("BLOCKED_BY_ACCESS", tools.filter((t) => !t.allowed).map(ref));
  add("NO_PROVIDER_FITS", tools.filter((t) => t.allowed && t.noProviderFits).map(ref));
  if (tools.length > 0 && !tools.some((t) => t.allowed)) warnings.push({ code: "NOTHING_ALLOWED", tools: [] });
  add("IGNORED_TOOLS", ignored.map((name) => ({ toolId: null, name })));

  // How tools/list presents it: the root searches, everything else is automatic (≤ 25 shown in full).
  const asked = parsed.options.discovery ?? null;
  const own = toolset?.discovery?.toLowerCase() as "auto" | "full" | "search" | undefined;
  const mode = asked ?? (choice.kind === "everything" ? "search" : (own ?? "auto"));
  const discovery: "FULL" | "SEARCH" = mode === "full" ? "FULL" : mode === "search" ? "SEARCH" : listed.length <= 25 ? "FULL" : "SEARCH";
  const pinned = [...(toolset?.pinnedTools ?? []), ...access.pinnedTools].filter((name, i, all) => all.indexOf(name) === i && listed.some((t) => t.name === name)).slice(0, 5);
  const listedTools = discovery === "SEARCH" ? [...pinned, ...META_TOOLS] : listed.map((t) => t.name);
  // About 230 tokens per tool definition (name, summary, price line, input schema); the three search tools about 190 each.
  const tokensOf = (name: string) => (META_TOOLS.includes(name) ? 190 : 210 + name.length * 2);

  const canonicalUrl = buildMcpUrl(parsed.choice, parsed.options, mcpHost());
  return {
    canonicalUrl,
    endpointKind: toolset || shared ? "TOOLSET" : choice.kind === "topic" ? "CATEGORY" : "ROOT",
    toolsetId: toolset?.id ?? shared?.id ?? null,
    toolsetName: toolset?.name ?? shared?.name ?? null,
    viewFilter:
      parsed.choice.kind === "tools" || parsed.options.free
        ? {
            ...(parsed.choice.kind === "tools" ? { tools: canonicalTools(parsed.choice.tools) } : {}),
            ...(parsed.options.free ? { free: true } : {}),
          }
        : null,
    discovery,
    listedCount: listedTools.length,
    reachableCount: listed.length,
    listedTools,
    estimatedTokens: listedTools.reduce((sum, name) => sum + tokensOf(name), 0),
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
    const choice = parsed?.choice ?? null;
    const toolset = choice?.kind === "toolset" ? s.toolsets.find((t) => t.slug === choice.slug) : null;
    const shared = choice ? sharedSetOf(choice, s) : null;
    const lockedTo = choice && (choice.kind === "shared" || choice.kind === "link" || choice.kind === "toolset") ? (choice.version ?? null) : null;
    const latest = toolset ? (toolset.latestVersion ?? null) : (shared?.latest ?? null);
    const discovery = preview?.discovery ?? "FULL";
    return {
      canonicalUrl: row.canonicalUrl,
      endpointKind: preview?.endpointKind ?? (toolset || shared ? "TOOLSET" : "ROOT"),
      toolsetId: toolset?.id ?? shared?.id ?? null,
      name: preview?.toolsetName ?? row.serverName ?? "assay",
      serverName: row.serverName,
      client: row.client,
      toolCount: preview ? preview.listedCount : null,
      estimatedTokens: preview ? preview.estimatedTokens : null,
      discovery,
      searchUrl: discovery === "FULL" && parsed ? buildMcpUrl(parsed.choice, { ...parsed.options, discovery: "search" }, mcpHost()) : null,
      lastCallAt: row.lastCallAt,
      handedOutAt: row.handedOutAt,
      firstCallAt: row.firstCallAt,
      waitingForFirstCall: row.handedOutAt !== null && !row.firstCallAt && !row.lastCallAt,
      available: s.variant === "preview-error" ? true : preview !== null,
      updateAvailable: lockedTo !== null && latest !== null && latest > lockedTo,
      latestVersion: lockedTo !== null && latest !== null && latest > lockedTo ? latest : null,
      latestUrl:
        lockedTo !== null && latest !== null && latest > lockedTo && parsed && choice && (choice.kind === "shared" || choice.kind === "link" || choice.kind === "toolset")
          ? buildMcpUrl({ ...choice, version: latest }, parsed.options, mcpHost())
          : null,
    };
  });
  // The same rule as the backend: the tools shown in full by the servers that show every tool, over 25.
  const total = servers.filter((server) => server.discovery !== "SEARCH").reduce((sum, server) => sum + (server.toolCount ?? 0), 0);
  return { servers, overBudget: total > 25 };
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
      .map((f) => ({ providerId: f.providerId, providerName: demoProvider(f.providerId)?.legalName ?? null, ...f.reason! }));
  const marketQuote: RefusedCall = {
    callId: "rc-7f3a91d2-market-quote",
    agentId: PROD_AGENT,
    toolId: toolByName("Market quote")!.id,
    toolName: "Market quote",
    refusalCode: "NO_PROVIDER_MATCHES_RULES",
    refusalLayer: "AGENT_LIMITS",
    charged: false,
    // One provider, above the agent's max: "This tool has one provider".
    providers: [{ providerId: HARBORLIGHT, providerName: demoProvider(HARBORLIGHT)?.legalName ?? null, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "Quote 0.45 above the agent's max" }],
    endpointKind: "ROOT",
    toolsetId: null,
    toolsetVersion: null,
    viewFilter: null,
    createdAt: demoMinutesAgo(18),
  };
  if (s.variant === "single") return [marketQuote];
  const searchRule = research?.entries.find((e) => e.toolName === "search_web") ?? null;
  const searchReasons = reasons("search_web", searchRule);
  // T3: the contract refusals (Must return, contract version, an input nobody accepts, retired).
  const contract = contractRefusedCalls({
    agentId: PROD_AGENT,
    toolsetId: WEATHER_ID,
    providers: { helios: HELIOS, northwind: NORTHWIND, quanta: QUANTA },
    name: (id) => demoProvider(id)?.legalName ?? null,
  });
  return ([
    ...contract,
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
          : [{ providerId: COBALT, providerName: demoProvider(COBALT)?.legalName ?? null, reason: "ABOVE_MAX_PRICE", source: "AGENT", detail: "Quote 0.0080 above the agent's max" }],
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
  ] satisfies RefusedCall[]).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/* ------------------------------------------------------- the writes */

function newId(): string {
  return crypto.randomUUID();
}

function entriesFrom(input: unknown): ToolsetEntry[] {
  const list = Array.isArray(input) ? (input as ToolsetEntryInput[]) : [];
  return list
    .map((e, position): ToolsetEntry | null => {
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
        toolVersionRange: e.toolVersionRange ?? currentRangeOf(tool.id),
        requireOutputFields: Array.isArray(e.requireOutputFields) ? e.requireOutputFields.filter((f): f is string => typeof f === "string") : [],
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
  return dto(next);
}

function page<T>(items: T[]) {
  return { items, pageInfo: { nextCursor: null, hasMore: false } };
}

/* --------------------------------------------- sharing (T2): helpers */

function refuse(code: string, message: string, status: number, path: string, context?: Record<string, unknown>): never {
  throw new ApiError(code, message, status, path, context);
}

function newToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  // 252 is the largest multiple of 36 below 256, so dropping bytes from 252 up keeps every letter equally likely.
  const out: string[] = [];
  while (out.length < 22) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 252 && out.length < 22) out.push(alphabet[byte % alphabet.length]);
    }
  }
  return out.join("");
}

function summaryOf(v: ToolsetVersion) {
  return { version: v.version, publishedAt: v.publishedAt, changelog: v.changelog, name: v.name, toolCount: v.toolCount };
}

function isShared(set: Toolset): boolean {
  return set.visibility !== "PRIVATE";
}

/** The publisher dashboard and public figures of one of ours: above 5 teams when listed, below when only linked. */
function ownStats(set: Toolset): ToolsetOwnStats {
  const s = current();
  if (!set.latestVersion || (!isShared(set) && !set.sharingEndsAt)) return { weekStart: null, figures: null, dashboard: null };
  const big = set.visibility === "PUBLIC";
  const few = { value: null, display: "Fewer than 5" };
  const fewOrgs = { value: null, display: "Fewer than 5 orgs" };
  const versions = s.versions[set.id] ?? [];
  return {
    weekStart: demoWeekStart(),
    figures: big
      ? {
          activeUsers: { value: 25, display: "25" },
          agents: { value: 40, display: "40" },
          calls30d: { value: 3_400, display: "3.4k" },
          copies: few,
          trend: "UP",
          onLatestVersionPercent: 60,
        }
      : { activeUsers: few, agents: null, calls30d: null, copies: few, trend: null, onLatestVersionPercent: null },
    dashboard: {
      tools: set.entries.map((e, i) => {
        const withheld = !big || i === 2;
        return {
          toolId: e.toolId,
          toolName: e.toolName,
          calls: withheld ? { value: null, display: "Fewer than 5 orgs" } : { value: [1_900, 900, 0, 400][i] ?? 300, display: ["1.9k", "900", "0", "400"][i] ?? "300" },
          errorRatePercent: withheld ? null : [2, 1, 0, 4][i] ?? 1,
          notChargedRatePercent: withheld ? null : [1, 0, 0, 3][i] ?? 0,
          withheld,
        };
      }),
      versions: versions.map((v, i) =>
        big
          ? { version: v.version, orgs: i === 0 ? { value: 15, display: "15" } : i === 1 ? { value: 10, display: "10" } : fewOrgs, stoppedAfterUpdate: i === 1 ? fewOrgs : { value: 0, display: "0" } }
          : { version: v.version, orgs: fewOrgs, stoppedAfterUpdate: { value: 0, display: "0" } },
      ),
    },
  };
}

/** One of ours as the public page shows it (only what was published). */
function ownPublicPage(set: Toolset, v: number | null, via: "PUBLIC" | "UNLISTED"): PublicToolsetPage {
  const s = current();
  const version = (s.versions[set.id] ?? []).find((x) => x.version === (v ?? set.latestVersion)) ?? null;
  if (!version) refuse("TOOLSET_VERSION_NOT_FOUND", "Tool set version not found", 404, "/public/toolsets");
  const host = mcpHost();
  const latest = via === "PUBLIC" ? `${host}/@${s.handle}/${set.slug}` : `${host}/u/${set.unlistedToken}`;
  const stats = ownStats(set);
  return {
    id: set.id,
    handle: s.handle ?? DEMO_OWN_HANDLE,
    slug: set.slug,
    name: version.name,
    description: version.description,
    category: set.category,
    tags: [...set.tags],
    icon: version.icon,
    badge: "COMMUNITY",
    version: version.version,
    toolCount: version.toolCount,
    toolIds: version.entries.map((e) => e.toolId),
    activeUsers: stats.figures?.activeUsers ?? null,
    mcpUrls: { latest, pinned: `${latest}@${version.version}`, recommended: `${latest}@${version.version}` },
    changelog: version.changelog,
    publishedAt: version.publishedAt,
    entries: version.entries.map((e) => ({
      toolId: e.toolId,
      toolName: e.toolName,
      providerMode: e.providerMode,
      providerCount: e.providerIds.length,
      minTier: e.minTier,
      onEmpty: e.onEmpty,
      removed: false,
      notReviewed: false,
      toolVersionRange: e.toolVersionRange ?? null,
      requireOutputFields: [...(e.requireOutputFields ?? [])],
    })),
    notReviewed: false,
    diff: null,
    routesToPublisher: false,
    stats: { weekStart: stats.weekStart, ...(stats.figures ?? { activeUsers: null, agents: null, calls30d: null, copies: null, trend: null, onLatestVersionPercent: null }) },
    forkedFrom: null,
    sharingEndsAt: set.sharingEndsAt ?? null,
  };
}

/** Every listed card: the catalogue's and ours while listed. */
function listedCards(): { card: PublicToolsetCard; set: DemoPublicSet | null; age: number; popular: number; trending: number }[] {
  const s = current();
  const host = mcpHost();
  const theirs = DEMO_PUBLIC_SETS.filter((x) => !x.unlistedToken).map((x) => ({ card: demoPublicCard(x, host), set: x, age: demoSetAgeMinutes(x), popular: x.popular, trending: x.trending }));
  const ours = s.toolsets
    .filter((t) => t.visibility === "PUBLIC" && t.listingStatus === "LISTED" && !t.removed && s.handle)
    .map((t) => {
      const { changelog: _c, publishedAt: _p, entries: _e, stats: _s, forkedFrom: _f, sharingEndsAt: _x, ...card } = ownPublicPage(t, null, "PUBLIC");
      return { card, set: null, age: 3 * DAY, popular: 20, trending: 0.3 };
    });
  return [...theirs, ...ours];
}

function matchesQuery(card: PublicToolsetCard, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const toolNames = card.toolIds.map((id) => toolById(id)?.name ?? id);
  return [card.name, card.description ?? "", card.category ?? "", card.handle, ...card.tags, ...toolNames].some((f) => f.toLowerCase().includes(needle));
}

/** A copy of a tool set, own or another organization's: entries that are another org's link-only tools stay behind. */
function copyOf(id: string, body: Record<string, unknown>, path: string) {
  const s = current();
  const own = s.toolsets.find((t) => t.id === id);
  const pub = DEMO_PUBLIC_SETS.find((x) => x.id === id);
  if (!own && !pub) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
  if (pub?.unlistedToken && body.unlistedToken !== pub.unlistedToken) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
  const sourceName = own?.name ?? pub!.name;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : sourceName;
  const excluded: { toolId: string; toolName: string; reason: string }[] = [];
  let entries: ToolsetEntry[] = [];
  if (own) {
    entries = own.entries.map((e, position) => ({ ...e, position }));
  } else {
    for (const t of pub!.tools) {
      const tool = toolByName(t.name);
      if (t.removed) excluded.push({ toolId: demoToolIdOf(pub!, t.name), toolName: t.name, reason: "REMOVED" });
      else if (!tool) excluded.push({ toolId: demoToolIdOf(pub!, t.name), toolName: t.name, reason: "LINK_ONLY" });
      else entries.push(entry(entries.length, tool.name));
    }
  }
  let slug = slugOf(name);
  for (let n = 2; s.toolsets.some((t) => t.slug === slug); n += 1) slug = `${slugOf(name).slice(0, 60)}-${n}`;
  const set = toolsetRow(newId(), slug, name, own?.description ?? pub!.description, entries, 0);
  set.createdAt = new Date().toISOString();
  set.updatedAt = set.createdAt;
  set.forkedFrom = { toolsetId: id, version: typeof body.version === "number" ? body.version : (own ? null : pub!.versions[0]!.version) };
  s.toolsets = [set, ...s.toolsets];
  return { toolset: dto(set), excluded };
}

function handleDto() {
  const s = current();
  const locked = s.toolsets.some((t) => isShared(t) || t.sharingEndsAt);
  return { handle: s.handle, status: s.handle ? "ACTIVE" : null, lockedAt: locked && s.handle ? demoMinutesAgo(20 * DAY) : null, canChange: !(locked && s.handle) };
}

function claimHandle(input: unknown, path: string) {
  const s = current();
  const handle = normaliseHandle(String(input ?? ""));
  if (!HANDLE_RE.test(handle)) refuse("TOOLSET_HANDLE_INVALID", "Invalid public name", 400, path, { reason: "FORMAT" });
  const reserved = ["assay", "official", "admin", "tools", "toolset", "support", "help", "api", "docs", "weather", "finance", "web", "knowledge"];
  if (reserved.includes(handle)) refuse("TOOLSET_HANDLE_INVALID", "This public name is reserved", 400, path, { reason: "RESERVED" });
  if (s.variant === "claim-refused") refuse("TOOLSET_HANDLE_CLAIM_REFUSED", "Add funds once before choosing a public name", 403, path, { reason: "NOT_VERIFIED" });
  if (handleDto().canChange === false && handle !== s.handle) refuse("TOOLSET_HANDLE_LOCKED", "Your public name is in use", 409, path);
  const takenHere = TAKEN_HANDLES.has(handle) || (s.variant === "handle-taken" && !s.suggested.includes(handle));
  if (takenHere) {
    const base = handle.slice(0, 20);
    s.suggested = [`${base}-hq`, `${base}-labs`, `${base}2`].filter((x) => HANDLE_RE.test(x));
    refuse("TOOLSET_HANDLE_TAKEN", "This public name is taken", 409, path, { suggestions: s.suggested });
  }
  s.handle = handle;
  return handleDto();
}

function categories(): PublicCategory[] {
  const counts = new Map<string, { tools: number; toolsets: number }>();
  for (const tool of catalogue().filter((t) => t.offers.length > 0)) {
    const c = categoryOf(tool.name);
    const row = counts.get(c) ?? { tools: 0, toolsets: 0 };
    row.tools += 1;
    counts.set(c, row);
  }
  for (const { card } of listedCards()) {
    if (!card.category) continue;
    const row = counts.get(card.category) ?? { tools: 0, toolsets: 0 };
    row.toolsets += 1;
    counts.set(card.category, row);
  }
  return [...counts.entries()].map(([category, n]) => ({ category, ...n })).sort((a, b) => a.category.localeCompare(b.category));
}

/** The alert "prod"'s team gets in `update-available` (FR-17). */
export function demoToolsetNotifications(): unknown[] {
  // Every picture but `empty` has the alert, so "See what changed" can be tried from the bell.
  if (demoConnectVariant() === "empty") return [];
  return [
    {
      id: "ntf_ts31",
      event: "toolset.update_available",
      severity: "INFO",
      title: "@marketkit/crypto-research v3 is available",
      body: "Added: get_usd_eur_rate. Provider rules changed: get_token_market.",
      subjectType: "toolset",
      subjectId: MARKETKIT_SET.id,
      payload: {
        toolsetId: MARKETKIT_SET.id,
        handle: "marketkit",
        slug: "crypto-research",
        fromVersion: 2,
        toVersion: 3,
        mcpUrl: `${mcpHost()}/@marketkit/crypto-research@3`,
        diff: { added: ["get_usd_eur_rate"], removed: [], rulesChanged: ["get_token_market"], settingsChanged: [] },
      },
      readAt: null,
      createdAt: demoMinutesAgo(2 * DAY - 30),
    },
  ];
}

export const TOOLSET_FIXTURES: readonly DemoFixture[] = [
  {
    method: "GET",
    match: "/toolsets",
    body: () => page(current().toolsets.map((set) => dto(set)).map(({ entries: _entries, ...summary }) => summary)),
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
      return dto(set);
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
    body: (path) => dto(requireToolset(path)),
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
      if (data?.discovery === "AUTO" || data?.discovery === "FULL" || data?.discovery === "SEARCH") patch.discovery = data.discovery;
      if (Array.isArray(data?.pinnedTools)) {
        if ((data.pinnedTools as unknown[]).length > 5) throw new ApiError("TOOLSET_LIMIT_EXCEEDED", "At most 5 always-loaded tools", 429, path, { limit: "pinnedTools", max: 5 });
        patch.pinnedTools = (data.pinnedTools as unknown[]).filter((x): x is string => typeof x === "string");
      }
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
      const sets: { toolsetId: string; viaUrlOnly: boolean; version: number | null }[] = [];
      const ids = new Set<string>();
      for (const row of s.connect[agentId] ?? []) {
        const parsed = parseMcpUrl(row.canonicalUrl, mcpHost());
        if (!parsed) continue;
        if (parsed.choice.kind === "everything") everything = true;
        if (parsed.choice.kind === "tools") for (const name of parsed.choice.tools) if (toolByName(name)) ids.add(toolByName(name)!.id);
        if (parsed.choice.kind === "toolset") {
          const slug = parsed.choice.slug;
          const set = s.toolsets.find((t) => t.slug === slug);
          if (set && !sets.some((r) => r.toolsetId === set.id)) sets.push({ toolsetId: set.id, viaUrlOnly: true, version: parsed.choice.version ?? null });
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
        const refs = body.allowedToolsets as { toolsetId: string; viaUrlOnly?: boolean; version?: number | null }[];
        // Another organization's tool set must be locked to a version (Official ones may follow the latest).
        const unpinned = refs.find((r) => {
          const pub = DEMO_PUBLIC_SETS.find((x) => x.id === r.toolsetId);
          return pub && pub.badge !== "OFFICIAL" && !r.version;
        });
        if (unpinned) {
          throw new ApiError("TOOLSET_ACCESS_INVALID", "Another organization's tool set must be pinned to a version", 400, path, {
            reason: "another organization's tool set must be pinned to a version",
            toolsetIds: [unpinned.toolsetId],
          });
        }
        next.allowedToolsets = refs.map((r) => ({
          toolsetId: r.toolsetId,
          viaUrlOnly: r.viaUrlOnly !== false,
          version: r.version ?? null,
          status: access.allowedToolsets.find((x) => x.toolsetId === r.toolsetId)?.status,
        }));
      }
      if (Array.isArray(body.pinnedTools)) {
        if ((body.pinnedTools as unknown[]).length > 5) {
          throw new ApiError("TOOLSET_LIMIT_EXCEEDED", "At most 5 always-loaded tools", 429, path, { limit: "pinnedTools", max: 5 });
        }
        next.pinnedTools = [...new Set(body.pinnedTools as string[])];
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
  /* ------------------------------------------------ sharing (T2) */
  {
    method: "POST",
    match: /^\/toolsets\/[^/]+\/publish$/,
    body: (path, _query, data): PublishResult => {
      const s = current();
      const set = requireToolset(path);
      const visibility = (["PRIVATE", "UNLISTED", "PUBLIC"].includes(String(data?.visibility)) ? data!.visibility : "PRIVATE") as ToolsetVisibility;
      if (set.removed) refuse("TOOLSET_SHARING_REFUSED", "This tool set cannot be changed that way", 409, path, { refusal: "TAKEN_DOWN" });
      if (visibility !== "PRIVATE" && !s.handle) refuse("TOOLSET_HANDLE_REQUIRED", "Choose a public name before sharing", 409, path);
      if (set.entries.length === 0) refuse("TOOLSET_NOT_PUBLISHABLE", "This tool set cannot be published", 400, path, { reason: "a tool set needs at least one tool" });
      const previous = (s.versions[set.id] ?? [])[0] ?? null;
      const draft: Snapshot = snapshotOfDraft(set);
      const diff = diffSnapshots(previous, draft);
      const version = (set.latestVersion ?? 0) + 1;
      const typed = typeof data?.changelog === "string" ? data.changelog.trim() : "";
      const snapshot = versionOf(set, version, set.entries, 0, typed || changelogFrom(diff, previous === null, set.entries.length));
      snapshot.publishedAt = new Date().toISOString();
      snapshot.discovery = set.discovery as ToolsetVersion["discovery"];
      snapshot.pinnedTools = [...set.pinnedTools];
      s.versions[set.id] = [snapshot, ...(s.versions[set.id] ?? [])];
      const wasShared = isShared(set);
      const next = touch(set, {
        visibility,
        latestVersion: version,
        listingStatus: visibility === "PUBLIC" ? "LISTED" : null,
        delisted: false,
        unlistedToken: visibility !== "PRIVATE" ? (set.unlistedToken ?? newToken()) : set.unlistedToken,
        sharingEndsAt: visibility === "PRIVATE" && wasShared ? demoMinutesAgo(-90 * DAY) : visibility === "PRIVATE" ? set.sharingEndsAt : null,
      });
      return { toolset: next, version: summaryOf(snapshot), diff };
    },
  },
  {
    method: "POST",
    match: /^\/toolsets\/[^/]+\/unpublish$/,
    body: (path): PublishResult => {
      const set = requireToolset(path);
      if (set.removed) refuse("TOOLSET_SHARING_REFUSED", "This tool set cannot be changed that way", 409, path, { refusal: "TAKEN_DOWN" });
      const next = touch(set, { visibility: "PRIVATE", listingStatus: null, delisted: false, sharingEndsAt: isShared(set) ? demoMinutesAgo(-90 * DAY) : set.sharingEndsAt });
      return { toolset: next, version: null, diff: null };
    },
  },
  {
    method: "POST",
    match: /^\/toolsets\/[^/]+\/unlisted-token\/rotate$/,
    body: (path): PublishResult => {
      const set = requireToolset(path);
      if (!isShared(set) || set.removed) refuse("TOOLSET_SHARING_REFUSED", "This tool set cannot be changed that way", 409, path, { refusal: "NOT_SHARED" });
      return { toolset: touch(set, { unlistedToken: newToken() }), version: null, diff: null };
    },
  },
  {
    method: "GET",
    match: /^\/toolsets\/[^/]+\/versions$/,
    body: (path) => (current().versions[requireToolset(path).id] ?? []).map(summaryOf),
  },
  {
    method: "GET",
    match: /^\/toolsets\/[^/]+\/versions\/\d+$/,
    body: (path) => {
      const set = requireToolset(path);
      const v = Number(path.split("/")[4]);
      const found = (current().versions[set.id] ?? []).find((x) => x.version === v);
      if (!found) refuse("TOOLSET_VERSION_NOT_FOUND", "Tool set version not found", 404, path);
      return found;
    },
  },
  {
    method: "POST",
    match: /^\/toolsets\/[^/]+\/copy$/,
    body: (path, _query, data) => copyOf(decodeURIComponent(path.split("/")[2] ?? ""), data ?? {}, path),
  },
  {
    method: "GET",
    match: /^\/toolsets\/[^/]+\/stats$/,
    body: (path) => ownStats(requireToolset(path)),
  },
  {
    method: "GET",
    match: "/org/handle",
    body: () => handleDto(),
  },
  {
    method: "PUT",
    match: "/org/handle",
    body: (path, _query, data) => claimHandle(data?.handle, path),
  },
  {
    method: "POST",
    match: "/reports",
    body: (path, _query, data) => {
      const s = current();
      const target = String(data?.toolsetId ?? data?.toolId ?? data?.handle ?? "");
      if (!target) refuse("TOOLSET_INVALID", "name exactly one of toolsetId, toolId, handle", 400, path);
      if (s.reports.has(target)) refuse("TOOLSET_REPORT_DUPLICATE", "Your organization already has an open report about this", 409, path);
      s.reports.add(target);
      return { id: newId(), createdAt: new Date().toISOString() };
    },
  },
  {
    method: "GET",
    match: "/public/toolsets",
    body: (_path, query) => {
      const q = typeof query.q === "string" ? query.q : "";
      const category = typeof query.category === "string" ? query.category : null;
      const publisher = typeof query.publisher === "string" ? query.publisher.toUpperCase() : null;
      const sort = typeof query.sort === "string" ? query.sort : "popular";
      const rows = listedCards()
        .filter(({ card }) => (!category || card.category === category) && (!publisher || card.badge === publisher) && matchesQuery(card, q))
        .sort((a, b) => (sort === "new" ? a.age - b.age : sort === "trending" ? b.trending - a.trending : b.popular - a.popular));
      const offset = Number(query.offset ?? 0) || 0;
      const limit = Number(query.limit ?? 50) || 50;
      return { toolsets: rows.slice(offset, offset + limit).map((r) => r.card), total: rows.length };
    },
  },
  {
    method: "POST",
    match: "/public/toolsets/by-token",
    body: (path, _query, data) => {
      const s = current();
      const token = String(data?.token ?? "");
      const v = typeof data?.v === "number" ? data.v : null;
      const diffFrom = typeof data?.diffFrom === "number" ? data.diffFrom : null;
      const pub = DEMO_PUBLIC_SETS.find((x) => x.unlistedToken === token);
      if (pub) {
        if (v && !pub.versions.some((x) => x.version === v)) refuse("TOOLSET_VERSION_NOT_FOUND", "Tool set version not found", 404, path);
        if (diffFrom && !pub.versions.some((x) => x.version === diffFrom)) refuse("TOOLSET_VERSION_NOT_FOUND", "Tool set version not found", 404, path);
        return demoPublicPage(pub, mcpHost(), v, diffFrom);
      }
      const own = s.toolsets.find((t) => t.unlistedToken === token && !t.removed && (isShared(t) || t.sharingEndsAt));
      if (!own) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
      return ownPublicPage(own, v, "UNLISTED");
    },
  },
  {
    method: "GET",
    match: /^\/public\/toolsets\/@[^/]+\/[^/]+\/versions\/\d+$/,
    body: (path, query) => {
      const [, , , at = "", slug = "", , v = ""] = path.split("/");
      const handle = decodeURIComponent(at).replace(/^@/, "");
      const pub = DEMO_PUBLIC_SETS.find((x) => !x.unlistedToken && x.ownerHandle === handle && x.slug === slug);
      const diffFrom = Number(query.diffFrom) || null;
      const detail = pub ? demoPublicVersionDetail(pub, Number(v), diffFrom) : null;
      if (!detail) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
      return detail;
    },
  },
  {
    method: "GET",
    match: /^\/public\/toolsets\/@[^/]+\/[^/]+\/versions$/,
    body: (path) => {
      const [, , , at = "", slug = ""] = path.split("/");
      const handle = decodeURIComponent(at).replace(/^@/, "");
      const pub = DEMO_PUBLIC_SETS.find((x) => !x.unlistedToken && x.ownerHandle === handle && x.slug === slug);
      if (pub) return { versions: demoPublicVersions(pub) };
      const s = current();
      const own = s.toolsets.find((t) => s.handle === handle && t.slug === slug && t.visibility === "PUBLIC" && !t.removed);
      if (!own) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
      return { versions: (s.versions[own.id] ?? []).map((x) => ({ version: x.version, publishedAt: x.publishedAt, changelog: x.changelog, toolCount: x.toolCount })) };
    },
  },
  {
    method: "GET",
    match: /^\/public\/toolsets\/@[^/]+\/[^/]+$/,
    body: (path) => {
      const [, , , at = "", slug = ""] = path.split("/");
      const handle = decodeURIComponent(at).replace(/^@/, "");
      const pub = DEMO_PUBLIC_SETS.find((x) => !x.unlistedToken && x.ownerHandle === handle && x.slug === slug);
      if (pub) return demoPublicPage(pub, mcpHost());
      const s = current();
      const own = s.toolsets.find((t) => s.handle === handle && t.slug === slug && t.visibility === "PUBLIC" && t.listingStatus === "LISTED" && !t.removed);
      if (!own) refuse("TOOLSET_NOT_FOUND", "Tool set not found", 404, path);
      return ownPublicPage(own, null, "PUBLIC");
    },
  },
  {
    method: "GET",
    match: /^\/public\/handles\/[^/]+$/,
    body: (path) => {
      const handle = decodeURIComponent(path.split("/")[3] ?? "").replace(/^@/, "").toLowerCase();
      const cards = listedCards().filter(({ card }) => card.handle === handle).map(({ card }) => card);
      if (cards.length === 0 && handle !== current().handle && !TAKEN_HANDLES.has(handle)) {
        refuse("TOOLSET_HANDLE_NOT_FOUND", "Handle not found", 404, path);
      }
      return { handle, renamedTo: null, toolsets: cards, tools: [] };
    },
  },
  {
    method: "GET",
    match: "/public/categories",
    body: () => ({ categories: categories() }),
  },
];
