import { publicApi } from "./public-api";
import type { Figure } from "./toolsets.service";

/**
 * Public tool sets (design spec §7.9, "Public"): no sign-in, rate limited per
 * IP. Shapes are the backend's `public-toolsets.dto.ts`, field for field.
 *
 * Cards carry tool ids, not prices: the screens join them with
 * `GET /public/catalogue/tools` for the price range and "No backup provider".
 * Figures arrive already rounded and k-checked ("Fewer than 5").
 */

export type PublisherFilter = "official" | "provider" | "community";
export type ToolsetSort = "popular" | "trending" | "new";
export type ToolsetBadge = "OFFICIAL" | "PROVIDER" | "COMMUNITY";

export interface PublicToolsetUrls {
  /** Follows the latest version. */
  latest: string;
  /** Pinned to the current version. */
  pinned: string;
  /** What Connect offers by default: latest for Official, pinned for everyone else. */
  recommended: string;
}

export interface PublicToolsetCard {
  /** For "Make my own version", Report and allowing it in "What this agent can use". */
  id: string;
  handle: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  icon: string | null;
  badge: ToolsetBadge | string;
  version: number;
  toolCount: number;
  toolIds: string[];
  activeUsers: Figure | null;
  mcpUrls: PublicToolsetUrls;
  /** "Routes to the publisher's own provider": for at least one tool, the rules leave only the publisher's providers. */
  routesToPublisher: boolean;
}

export interface PublicToolsetList {
  toolsets: PublicToolsetCard[];
  total: number;
}

export interface PublicToolsetEntry {
  toolId: string;
  toolName: string;
  providerMode: "BEST" | "ONLY" | "EXCLUDE" | string;
  providerCount: number;
  minTier: string | null;
  onEmpty: "FAIL" | "FALLBACK_BEST" | string;
  /** No longer served (removed or retired): "Removed". */
  removed: boolean;
  /** One maker's own tool, not reviewed for the catalogue: "Not reviewed". */
  notReviewed: boolean;
  /** T3: the contract majors this entry routes to, e.g. "^1"; null follows the current major. */
  toolVersionRange?: string | null;
  /** T3: "Must return" — output fields every serving provider must return. */
  requireOutputFields?: string[];
}

/** What changed between two versions; settings use internal names (shown through `settingLabel`). */
export interface PublicToolsetDiff {
  from: number;
  to: number;
  added: string[];
  removed: string[];
  rulesChanged: string[];
  settingsChanged: string[];
}

export interface PublicToolsetStats {
  weekStart: string | null;
  activeUsers: Figure | null;
  agents: Figure | null;
  calls30d: Figure | null;
  copies: Figure | null;
  trend: "UP" | "DOWN" | "FLAT" | null;
  onLatestVersionPercent: number | null;
}

export interface PublicToolsetPage extends PublicToolsetCard {
  changelog: string | null;
  publishedAt: string;
  entries: PublicToolsetEntry[];
  /** Any entry is "Not reviewed". */
  notReviewed: boolean;
  /** Only on by-token with `diffFrom`. */
  diff?: PublicToolsetDiff | null;
  stats: PublicToolsetStats;
  forkedFrom: { handle: string; slug: string; version: number | null } | null;
  /** A link-only page in its grace period: old URLs stop serving then. */
  sharingEndsAt: string | null;
}

export interface PublicToolsetVersion {
  version: number;
  publishedAt: string;
  changelog: string | null;
  toolCount: number;
}

/** One version a listed tool set serves on `/@…`, with its tools and, with `diffFrom`, the diff. */
export interface PublicToolsetVersionDetail extends PublicToolsetVersion {
  name: string;
  description: string | null;
  icon: string | null;
  toolIds: string[];
  entries: PublicToolsetEntry[];
  notReviewed: boolean;
  routesToPublisher: boolean;
  diff: PublicToolsetDiff | null;
}

/** One LISTED provider tool of a public name (`PublicHandleToolDto`). */
export interface PublicHandleTool {
  id: string;
  /** `{handle}__{tool}`. */
  name: string;
  /** The 200-character summary an agent reads in tools/list. */
  summary: string;
  category: string;
  tags: string[];
  /** Never GUARANTEED for a provider tool. */
  tier: "UNVERIFIED" | "VERIFIED" | string;
  version: string | null;
  kind: "PROVIDER" | string;
  /** Always true on this page: only reviewed (LISTED) tools are shown. */
  reviewed: boolean;
  /** The standard tool it points to, once promoted. */
  replacementName: string | null;
}

export interface PublicHandleProfile {
  handle: string;
  /** Set when the name asked for is an old one. */
  renamedTo: string | null;
  toolsets: PublicToolsetCard[];
  /** Every LISTED provider tool of this public name. */
  tools: PublicHandleTool[];
  /** `/@{handle}` on the MCP host: serves every tool above; null when there is none. */
  mcpUrl?: string | null;
}

export interface PublicCategory {
  category: string;
  tools: number;
  toolsets: number;
}

export interface ListPublicToolsetsQuery {
  q?: string;
  category?: string;
  publisher?: PublisherFilter;
  sort?: ToolsetSort;
  limit?: number;
  offset?: number;
}

export function listPublicToolsets(query: ListPublicToolsetsQuery = {}): Promise<PublicToolsetList> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params[key] = value;
  return publicApi.get<PublicToolsetList>("/public/toolsets", params);
}

/** PUBLIC and LISTED only; anything else is the same 404. */
export function getPublicToolset(handle: string, slug: string): Promise<PublicToolsetPage> {
  return publicApi.get<PublicToolsetPage>(`/public/toolsets/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`);
}

export function listPublicToolsetVersions(handle: string, slug: string): Promise<{ versions: PublicToolsetVersion[] }> {
  return publicApi.get<{ versions: PublicToolsetVersion[] }>(`/public/toolsets/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/versions`);
}

/** One version and, with `diffFrom`, what changed since that version ("Update available"). */
export function getPublicToolsetVersion(handle: string, slug: string, v: number, diffFrom?: number | null): Promise<PublicToolsetVersionDetail> {
  return publicApi.get<PublicToolsetVersionDetail>(
    `/public/toolsets/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/versions/${v}`,
    diffFrom ? { diffFrom } : {},
  );
}

/** A link-only tool set's page. The token travels in the body, never in a URL. `diffFrom` adds the diff. */
export function getToolsetByToken(token: string, v?: number | null, diffFrom?: number | null): Promise<PublicToolsetPage> {
  return publicApi.post<PublicToolsetPage>("/public/toolsets/by-token", { token, ...(v ? { v } : {}), ...(diffFrom ? { diffFrom } : {}) });
}

export function getPublicHandle(handle: string): Promise<PublicHandleProfile> {
  return publicApi.get<PublicHandleProfile>(`/public/handles/${encodeURIComponent(handle)}`);
}

export function listPublicCategories(): Promise<{ categories: PublicCategory[] }> {
  return publicApi.get<{ categories: PublicCategory[] }>("/public/categories");
}
