import type {
  PublicToolsetCard,
  PublicToolsetDiff,
  PublicToolsetEntry,
  PublicToolsetPage,
  PublicToolsetStats,
  PublicToolsetVersion,
  PublicToolsetVersionDetail,
} from "@/services/public-toolsets.service";
import type { Figure } from "@/services/toolsets.service";

import { demoMinutesAgo } from "./demo-clock";
import { demoToolOffers } from "./fixtures-explore";

/**
 * DEMO ONLY — the public tool-set catalogue (design spec §7.8–§7.10): the
 * three Official sets the backend seeds, two community sets and one provider
 * set, plus one link-only set. Figures are what the weekly job would publish:
 * rounded, and withheld below 5 teams ("Fewer than 5"), so both sides of the
 * k = 5 rule are on screen.
 *
 * Tool ids are the Explorer's (`fixtures-explore.ts`), so a card's price range
 * and "No backup provider" come from the same offers the catalogue shows. One
 * link-only set holds a provider tool that is not in the catalogue
 * (`cobalt__news_search`): it reads "Not reviewed", and a copy leaves it out.
 */

const DAY = 1_440;

export interface DemoPublicSet {
  id: string;
  ownerHandle: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  badge: "OFFICIAL" | "PROVIDER" | "COMMUNITY";
  /** Tool names, as `demoToolOffers()` spells them; unknown names are provider tools outside the catalogue. */
  tools: { name: string; providerMode?: "BEST" | "ONLY" | "EXCLUDE"; providerCount?: number; removed?: boolean }[];
  /** Newest first. `tools` lists the tool names that version held (default: the set's current tools). */
  versions: { version: number; ageDays: number; changelog: string; toolCount: number; tools?: string[]; rulesChanged?: string[] }[];
  stats: Omit<PublicToolsetStats, "weekStart">;
  /** Days since first shared, for "New". */
  ageDays: number;
  popular: number;
  trending: number;
  routesToPublisher?: boolean;
  /** Link-only: reachable by token only, never listed. */
  unlistedToken?: string;
  /** Extra tools no catalogue tool matches, by id. */
  extraIds?: Record<string, string>;
}

function fig(n: number | null): Figure {
  if (n === null) return { value: null, display: "Fewer than 5" };
  return { value: n, display: String(n) };
}

function calls(display: string, value: number): Figure {
  return { value, display };
}

const FEW: Omit<PublicToolsetStats, "weekStart"> = {
  activeUsers: fig(null),
  agents: null,
  calls30d: null,
  copies: fig(null),
  trend: null,
  onLatestVersionPercent: null,
};

export const DEMO_PUBLIC_SETS: readonly DemoPublicSet[] = [
  {
    id: "0e5b8a3c-1f47-4d26-9a8b-3c7e2f1d6b05",
    ownerHandle: "assay",
    slug: "weather-and-places",
    name: "Weather and places",
    description: "Find a place by name, then its weather. Two tools, several providers each.",
    category: "weather",
    tags: ["weather", "maps"],
    badge: "OFFICIAL",
    tools: [{ name: "geocode_place" }, { name: "get_weather" }],
    versions: [
      { version: 2, ageDays: 9, changelog: "Changed provider rules for get_weather.", toolCount: 2, rulesChanged: ["get_weather"] },
      { version: 1, ageDays: 40, changelog: "First version: 2 tools.", toolCount: 2 },
    ],
    stats: { activeUsers: fig(140), agents: fig(310), calls30d: calls("48k", 48_000), copies: fig(20), trend: "UP", onLatestVersionPercent: 80 },
    ageDays: 40,
    popular: 140,
    trending: 0.2,
  },
  {
    id: "7a2d4c91-8e35-4b60-a1f9-5d3e8c2b7a14",
    ownerHandle: "assay",
    slug: "crypto-research",
    name: "Crypto research",
    description: "Token prices, a dollar–euro rate and a market quote, for research agents.",
    category: "finance",
    tags: ["crypto", "finance"],
    badge: "OFFICIAL",
    tools: [{ name: "get_token_market" }, { name: "get_usd_eur_rate" }, { name: "Market quote" }],
    versions: [{ version: 1, ageDays: 40, changelog: "First version: 3 tools.", toolCount: 3 }],
    stats: { activeUsers: fig(85), agents: fig(120), calls30d: calls("21k", 21_000), copies: fig(10), trend: "FLAT", onLatestVersionPercent: 100 },
    ageDays: 40,
    popular: 85,
    trending: 0,
  },
  {
    id: "c3f81e07-5b29-4a6d-8f42-1e9c7b3a5d60",
    ownerHandle: "assay",
    slug: "web-research",
    name: "Web research",
    description: "Search the web, read a page, look things up on Wikipedia and summarise.",
    category: "web",
    tags: ["search", "web", "knowledge"],
    badge: "OFFICIAL",
    tools: [{ name: "search_web" }, { name: "extract_page_text" }, { name: "search_wikipedia" }, { name: "summarize_document" }],
    versions: [
      { version: 4, ageDays: 3, changelog: "Added summarize_document.", toolCount: 4 },
      { version: 3, ageDays: 15, changelog: "Changed provider rules for search_web.", toolCount: 3, tools: ["search_web", "extract_page_text", "search_wikipedia"], rulesChanged: ["search_web"] },
      { version: 2, ageDays: 28, changelog: "Added search_wikipedia.", toolCount: 3, tools: ["search_web", "extract_page_text", "search_wikipedia"] },
      { version: 1, ageDays: 40, changelog: "First version: 2 tools.", toolCount: 2, tools: ["search_web", "extract_page_text"] },
    ],
    stats: { activeUsers: fig(210), agents: fig(480), calls30d: calls("96k", 96_000), copies: fig(35), trend: "UP", onLatestVersionPercent: 60 },
    ageDays: 40,
    popular: 210,
    trending: 0.35,
  },
  {
    id: "4b9e2f60-3c18-4d7a-b5e1-8a2c6f0d9e37",
    ownerHandle: "marketkit",
    slug: "crypto-research",
    name: "Crypto research desk",
    description: "Token markets with a currency rate, tuned for daily market notes.",
    category: "finance",
    tags: ["crypto", "markets"],
    badge: "COMMUNITY",
    tools: [{ name: "get_token_market", providerMode: "ONLY", providerCount: 2 }, { name: "get_usd_eur_rate" }, { name: "Chain activity summary" }],
    versions: [
      { version: 3, ageDays: 2, changelog: "Added get_usd_eur_rate. Changed provider rules for get_token_market.", toolCount: 3, rulesChanged: ["get_token_market"] },
      { version: 2, ageDays: 20, changelog: "Added Chain activity summary.", toolCount: 2, tools: ["get_token_market", "Chain activity summary"] },
      { version: 1, ageDays: 34, changelog: "First version: 1 tool.", toolCount: 1, tools: ["get_token_market"] },
    ],
    stats: { activeUsers: fig(35), agents: fig(60), calls30d: calls("12k", 12_000), copies: fig(10), trend: "UP", onLatestVersionPercent: 70 },
    ageDays: 34,
    popular: 30,
    trending: 0.6,
  },
  {
    id: "e8c35a17-2d94-4f0b-9c6e-7b1a4d8f2c53",
    ownerHandle: "geodesk",
    slug: "travel-planner",
    name: "Travel planner",
    description: "Where is it, what is the weather there, and what does a euro cost.",
    category: "weather",
    tags: ["travel", "weather"],
    badge: "COMMUNITY",
    tools: [{ name: "geocode_place" }, { name: "get_weather" }, { name: "get_usd_eur_rate" }],
    versions: [{ version: 1, ageDays: 4, changelog: "First version: 3 tools.", toolCount: 3 }],
    // Below k = 5: every figure is withheld.
    stats: FEW,
    ageDays: 4,
    popular: 2,
    trending: 0,
  },
  {
    id: "92d6b4e1-7a03-4c85-8e2f-6b5c1a9d3e74",
    ownerHandle: "quill",
    slug: "news-digest",
    name: "News digest",
    description: "Search, fetch and summarise the day's news on a topic.",
    category: "web",
    tags: ["news", "summaries"],
    badge: "COMMUNITY",
    tools: [{ name: "search_web" }, { name: "scrape_url" }, { name: "summarize_document" }, { name: "transcribe_audio", removed: true }],
    versions: [
      { version: 2, ageDays: 12, changelog: "Removed deep_research. Added scrape_url.", toolCount: 4 },
      { version: 1, ageDays: 60, changelog: "First version: 3 tools.", toolCount: 3, tools: ["search_web", "deep_research", "summarize_document"] },
    ],
    stats: { activeUsers: fig(120), agents: fig(200), calls30d: calls("35k", 35_000), copies: fig(15), trend: "DOWN", onLatestVersionPercent: 50 },
    ageDays: 60,
    popular: 95,
    trending: -0.15,
  },
  {
    id: "5f17c8a2-9b46-4e3d-a0c1-2e8d7b6f4a95",
    ownerHandle: "cobalt",
    slug: "fast-search",
    name: "Fast search",
    description: "Web search and page reading from Cobalt Street Data's own servers.",
    category: "web",
    tags: ["search", "web"],
    badge: "PROVIDER",
    tools: [{ name: "search_web", providerMode: "ONLY", providerCount: 1 }, { name: "scrape_url", providerMode: "ONLY", providerCount: 1 }],
    versions: [{ version: 1, ageDays: 18, changelog: "First version: 2 tools.", toolCount: 2 }],
    stats: { activeUsers: fig(15), agents: fig(20), calls30d: calls("2.4k", 2_400), copies: fig(null), trend: "FLAT", onLatestVersionPercent: null },
    ageDays: 18,
    popular: 12,
    trending: 0.05,
    routesToPublisher: true,
  },
  {
    // Link-only: never listed; its page opens with `#token=`.
    id: "a61f3d9c-4e82-4b17-9d05-c8e2b7a4f136",
    ownerHandle: "marketkit",
    slug: "desk-tools",
    name: "Desk tools",
    description: "The market team's own set, shared by link with partners.",
    category: "finance",
    tags: ["markets"],
    badge: "COMMUNITY",
    tools: [{ name: "get_token_market" }, { name: "FX reference rates" }, { name: "cobalt__news_search" }],
    versions: [
      { version: 2, ageDays: 6, changelog: "Added cobalt__news_search.", toolCount: 3 },
      { version: 1, ageDays: 25, changelog: "First version: 2 tools.", toolCount: 2, tools: ["get_token_market", "FX reference rates"] },
    ],
    stats: FEW,
    ageDays: 25,
    popular: 0,
    trending: 0,
    unlistedToken: "h3j8d2k9s6a1f4g7l0q5wz",
    extraIds: { cobalt__news_search: "d4e7a2c9-6b31-4f85-a0e8-1c9b5d3f7a26" },
  },
];

/** The id a tool name stands for: the Explorer's id, or the set's own id for a tool outside the catalogue. */
export function demoToolIdOf(set: Pick<DemoPublicSet, "extraIds">, name: string): string {
  return demoToolOffers().find((t) => t.name === name)?.id ?? set.extraIds?.[name] ?? name;
}

/** The Monday 00:00 UTC the figures were published (`toolset_stats_published.week_start`). */
export function demoWeekStart(): string {
  const now = new Date(demoMinutesAgo(0));
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function demoPublicCard(set: DemoPublicSet, host: string): PublicToolsetCard {
  const latest = set.unlistedToken ? `${host}/u/${set.unlistedToken}` : `${host}/@${set.ownerHandle}/${set.slug}`;
  const version = set.versions[0]!.version;
  const pinned = `${latest}@${version}`;
  return {
    id: set.id,
    handle: set.ownerHandle,
    slug: set.slug,
    name: set.name,
    description: set.description,
    category: set.category,
    tags: [...set.tags],
    icon: null,
    badge: set.badge,
    version,
    toolCount: set.tools.length,
    toolIds: set.tools.map((t) => demoToolIdOf(set, t.name)),
    activeUsers: set.stats.activeUsers,
    mcpUrls: { latest, pinned, recommended: set.badge === "OFFICIAL" ? latest : pinned },
    routesToPublisher: Boolean(set.routesToPublisher),
  };
}

function entriesOf(set: DemoPublicSet, names: readonly string[], version?: number): PublicToolsetEntry[] {
  return names.map((name) => {
    // A rule a later version changed was "Any provider" before it.
    const changedLater = version !== undefined && set.versions.some((x) => x.version > version && x.rulesChanged?.includes(name));
    const t = changedLater ? { name } : (set.tools.find((x) => x.name === name) ?? { name });
    return {
      toolId: demoToolIdOf(set, t.name),
      toolName: t.name,
      providerMode: ("providerMode" in t && t.providerMode) || "BEST",
      providerCount: "providerMode" in t && t.providerMode && t.providerMode !== "BEST" ? (("providerCount" in t && t.providerCount) || 1) : 0,
      minTier: null,
      onEmpty: "FAIL",
      removed: Boolean("removed" in t && t.removed),
      // A tool outside the public catalogue is one maker's own: "Not reviewed".
      notReviewed: !demoToolOffers().some((o) => o.name === t.name),
    };
  });
}

function toolsAt(set: DemoPublicSet, version: number): string[] {
  return set.versions.find((x) => x.version === version)?.tools ?? set.tools.map((t) => t.name);
}

/** The diff between two published versions, as the backend computes it. */
export function demoPublicDiff(set: DemoPublicSet, from: number, to: number): PublicToolsetDiff {
  const before = toolsAt(set, from);
  const after = toolsAt(set, to);
  const rules = set.versions.filter((x) => x.version > from && x.version <= to).flatMap((x) => x.rulesChanged ?? []);
  return {
    from,
    to,
    added: after.filter((n) => !before.includes(n)),
    removed: before.filter((n) => !after.includes(n)),
    rulesChanged: [...new Set(rules)].filter((n) => before.includes(n) && after.includes(n)),
    settingsChanged: [],
  };
}

export function demoPublicVersionDetail(set: DemoPublicSet, v: number, diffFrom?: number | null): PublicToolsetVersionDetail | null {
  const version = set.versions.find((x) => x.version === v);
  if (!version || (diffFrom && !set.versions.some((x) => x.version === diffFrom))) return null;
  const entries = entriesOf(set, toolsAt(set, v), v);
  return {
    version: v,
    publishedAt: demoMinutesAgo(version.ageDays * DAY),
    changelog: version.changelog,
    toolCount: entries.length,
    name: set.name,
    description: set.description,
    icon: null,
    toolIds: entries.map((e) => e.toolId),
    entries,
    notReviewed: entries.some((e) => e.notReviewed),
    routesToPublisher: Boolean(set.routesToPublisher),
    diff: diffFrom ? demoPublicDiff(set, diffFrom, v) : null,
  };
}

export function demoPublicPage(set: DemoPublicSet, host: string, v?: number | null, diffFrom?: number | null): PublicToolsetPage {
  const card = demoPublicCard(set, host);
  const shown = set.versions.find((x) => x.version === (v ?? card.version)) ?? set.versions[0]!;
  return {
    ...card,
    version: shown.version,
    changelog: shown.changelog,
    publishedAt: demoMinutesAgo(shown.ageDays * DAY),
    toolIds: toolsAt(set, shown.version).map((n) => demoToolIdOf(set, n)),
    toolCount: toolsAt(set, shown.version).length,
    entries: entriesOf(set, toolsAt(set, shown.version), shown.version),
    notReviewed: entriesOf(set, toolsAt(set, shown.version), shown.version).some((e) => e.notReviewed),
    diff: diffFrom ? demoPublicDiff(set, diffFrom, shown.version) : null,
    stats: { weekStart: set.stats.activeUsers ? demoWeekStart() : null, ...set.stats },
    forkedFrom: null,
    sharingEndsAt: null,
  };
}

export function demoPublicVersions(set: DemoPublicSet): PublicToolsetVersion[] {
  return set.versions.map((x) => ({ version: x.version, publishedAt: demoMinutesAgo(x.ageDays * DAY), changelog: x.changelog, toolCount: x.toolCount }));
}

export function demoSetAgeMinutes(set: DemoPublicSet): number {
  return set.ageDays * DAY;
}
