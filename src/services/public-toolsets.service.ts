import { api } from "./api";
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
  /**
   * The tool set's id, for "Make my own version", Report and allowing it in
   * "What this agent can use". NOT sent by the backend yet (contract gap):
   * without it those three actions are off on public pages.
   */
  id?: string;
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
  /**
   * "Routes to the publisher's own provider" (§7.7, computed at publish).
   * NOT sent by the backend yet (contract gap); the badge shows only when it is.
   */
  routesToPublisher?: boolean;
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

export interface PublicHandleProfile {
  handle: string;
  /** Set when the name asked for is an old one. */
  renamedTo: string | null;
  toolsets: PublicToolsetCard[];
  /** Provider tools (`{handle}__{tool}`); arrive with provider tools. */
  tools: string[];
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
  return api.get<PublicToolsetList>("/public/toolsets", params);
}

/** PUBLIC and LISTED only; anything else is the same 404. */
export function getPublicToolset(handle: string, slug: string): Promise<PublicToolsetPage> {
  return api.get<PublicToolsetPage>(`/public/toolsets/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`);
}

export function listPublicToolsetVersions(handle: string, slug: string): Promise<{ versions: PublicToolsetVersion[] }> {
  return api.get<{ versions: PublicToolsetVersion[] }>(`/public/toolsets/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/versions`);
}

/** A link-only tool set's page. The token travels in the body, never in a URL. */
export function getToolsetByToken(token: string, v?: number | null): Promise<PublicToolsetPage> {
  return api.post<PublicToolsetPage>("/public/toolsets/by-token", v ? { token, v } : { token });
}

export function getPublicHandle(handle: string): Promise<PublicHandleProfile> {
  return api.get<PublicHandleProfile>(`/public/handles/${encodeURIComponent(handle)}`);
}

export function listPublicCategories(): Promise<{ categories: PublicCategory[] }> {
  return api.get<{ categories: PublicCategory[] }>("/public/categories");
}
