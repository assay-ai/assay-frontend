import type { CursorPage, ListQuery, Money } from "@/interfaces";

import { api } from "./api";

/**
 * Tool sets, what an agent can use, the Connect preview, Servers in use and
 * refused calls (design spec §7.9, the T1 subset). Shapes are the backend's
 * DTOs (`toolset/dto/*.ts`, `mcp/dto/mcp-urls.dto.ts`), field for field.
 *
 * Words on the wire are internal (`BEST`, `FALLBACK_BEST`, `RESTRICTED`…);
 * the screens translate them through `features/toolsets/labels.ts` and never
 * print them.
 */

export type ProviderMode = "BEST" | "ONLY" | "EXCLUDE";
export type OnEmpty = "FAIL" | "FALLBACK_BEST";
export type ProviderTier = "NEW" | "ESTABLISHED" | "TRUSTED";
export type AccessMode = "ALL" | "RESTRICTED";
export type ToolAccessStanding = "ALLOWED" | "VIA_TOOLSET_URL" | "BLOCKED";
export type RefusalLayer = "SERVER" | "AGENT_LIMITS" | "TOOLSET_RULES";
export type EndpointKind = "ROOT" | "HANDLE" | "CATEGORY" | "TOOLSET";
export type ConnectClient = "claude-code" | "codex" | "cursor" | "vscode" | "windsurf" | "gemini" | "claude-desktop" | "claude-ai" | "chatgpt" | "other";
export type ToolsetVisibility = "PRIVATE" | "UNLISTED" | "PUBLIC";
export type ToolsetDiscovery = "AUTO" | "FULL" | "SEARCH";

/* ------------------------------------------------------------- tool sets */

export interface ToolsetEntryInput {
  toolId: string;
  providerMode: ProviderMode;
  providerIds: string[];
  minTier: ProviderTier | null;
  /** Atomic units in `asset`; `null` = no price limit. */
  maxPrice: { amount: string; asset: string } | null;
  minQuality: number | null;
  onEmpty: OnEmpty;
  /**
   * T3: the contract majors this entry routes to, `^1` or `^1 || ^2`. Omitted:
   * an entry already in the Draft keeps its range, a new one gets the tool's
   * current major. null (read): follows the current major.
   */
  toolVersionRange?: string | null;
  /** T3: "Must return" — output fields every serving provider must return (at most 20). */
  requireOutputFields?: string[];
}

export interface ToolsetEntry extends Omit<ToolsetEntryInput, "maxPrice"> {
  position: number;
  toolName: string;
  category: string;
  maxPrice: Money | null;
  /**
   * Newer servers: Assay took the tool down (its own takedown or its handle's,
   * or it was removed), so agents no longer see it. Read only, never sent back.
   */
  takenDown?: boolean;
}

/** The MCP URLs of one tool set (`ToolsetUrlsDto`); a shared one only while it is shared. */
export interface ToolsetUrls {
  /** The live Draft, `/my/{slug}`. */
  draft: string;
  /** "Lock to vN": `/my/{slug}@{latest}`. */
  myPinned: string | null;
  public: string | null;
  publicPinned: string | null;
  unlisted: string | null;
  unlistedPinned: string | null;
}

export interface ToolsetSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  icon: string | null;
  visibility: string;
  discovery: string;
  searchThreshold: number;
  pinnedTools: string[];
  /** The URL that serves the live Draft (`/my/{slug}`). */
  mcpUrl: string;
  toolCount: number;
  createdAt: string;
  updatedAt: string;
  /** T2 — sharing. Optional: a T1 backend does not send them. */
  publisherKind?: "USER" | "PLATFORM" | "PROVIDER";
  /** Your public name, when it is claimed. */
  handle?: string | null;
  listingStatus?: "LISTED" | "DELISTED" | null;
  /** The newest published version; null before v1. */
  latestVersion?: number | null;
  /** Old shared URLs keep serving until then ("This tool set stops working on …"). */
  sharingEndsAt?: string | null;
  delisted?: boolean;
  /** Taken down for abuse: only `/my/` serves. */
  removed?: boolean;
  urls?: ToolsetUrls;
  /** The link-only token while shared; owners only. */
  unlistedToken?: string | null;
  forkedFrom?: { toolsetId: string; version: number | null } | null;
}

export interface Toolset extends ToolsetSummary {
  entries: ToolsetEntry[];
}

export interface CreateToolsetBody {
  name: string;
  slug?: string;
  description?: string | null;
  entries?: ToolsetEntryInput[];
}

export interface UpdateToolsetBody {
  name?: string;
  slug?: string;
  description?: string | null;
  discovery?: ToolsetDiscovery;
  /** "Always loaded" tool names, at most 5. */
  pinnedTools?: string[];
}

export function listToolsets(query: ListQuery = {}): Promise<CursorPage<ToolsetSummary>> {
  return api.get<CursorPage<ToolsetSummary>>("/toolsets", { limit: 100, ...query } as Record<string, unknown>);
}

export function getToolset(id: string): Promise<Toolset> {
  return api.get<Toolset>(`/toolsets/${encodeURIComponent(id)}`);
}

/** Errors: `TOOLSET_SLUG_TAKEN` 409 with `context.suggestion`, `TOOLSET_LIMIT_EXCEEDED` 429. */
export function createToolset(body: CreateToolsetBody): Promise<Toolset> {
  return api.post<Toolset>("/toolsets", body);
}

export function updateToolset(id: string, body: UpdateToolsetBody): Promise<Toolset> {
  return api.patch<Toolset>(`/toolsets/${encodeURIComponent(id)}`, body);
}

/** Replaces the Draft: the change reaches every agent connected to `/my/{slug}` at once. */
export function replaceToolsetEntries(id: string, entries: ToolsetEntryInput[]): Promise<Toolset> {
  return api.put<Toolset>(`/toolsets/${encodeURIComponent(id)}/entries`, { entries });
}

export function deleteToolset(id: string): Promise<void> {
  return api.delete<void>(`/toolsets/${encodeURIComponent(id)}`);
}

/* ------------------------------------------- sharing, versions, copies */

export interface ToolsetVersionSummary {
  version: number;
  publishedAt: string;
  changelog: string | null;
  name: string;
  toolCount: number;
}

export interface ToolsetVersionEntry {
  toolId: string;
  /** The name at publish time. */
  toolName: string;
  providerMode: ProviderMode;
  providerIds: string[];
  minTier: ProviderTier | null;
  maxPrice: Money | null;
  minQuality: number | null;
  onEmpty: OnEmpty;
  /** T3. */
  toolVersionRange?: string | null;
  /** T3: "Must return". */
  requireOutputFields?: string[];
}

export interface ToolsetVersion extends ToolsetVersionSummary {
  description: string | null;
  icon: string | null;
  discovery: ToolsetDiscovery;
  searchThreshold: number;
  pinnedTools: string[];
  entries: ToolsetVersionEntry[];
}

/** What changed between two versions (`ToolsetDiffDto`); tool names, and internal setting names. */
export interface ToolsetDiff {
  added: string[];
  removed: string[];
  rulesChanged: string[];
  settingsChanged: string[];
}

export interface PublishResult {
  toolset: Toolset;
  version: ToolsetVersionSummary | null;
  diff: ToolsetDiff | null;
}

export interface CopyResult {
  toolset: Toolset;
  excluded: { toolId: string; toolName: string; reason: "LINK_ONLY" | "REMOVED" | string }[];
}

/** A figure that may be withheld: `value` null below k = 5, `display` what a page prints ("Fewer than 5"). */
export interface Figure {
  value: number | null;
  display: string;
}

export interface PublicFigures {
  activeUsers: Figure;
  agents: Figure | null;
  calls30d: Figure | null;
  copies: Figure;
  trend: "UP" | "DOWN" | "FLAT" | null;
  onLatestVersionPercent: number | null;
}

export interface DashboardFigures {
  tools: {
    toolId: string;
    toolName: string;
    calls: Figure | null;
    errorRatePercent: number | null;
    notChargedRatePercent: number | null;
    /** 1 to 4 orgs contribute: every number in the row is withheld. */
    withheld: boolean;
  }[];
  versions: { version: number; orgs: Figure; stoppedAfterUpdate: Figure }[];
}

export interface ToolsetOwnStats {
  /** The Monday these were published; null before the first week. */
  weekStart: string | null;
  figures: PublicFigures | null;
  dashboard: DashboardFigures | null;
}

/**
 * The Share dialog in one step. Errors: `TOOLSET_HANDLE_REQUIRED` 409,
 * `TOOLSET_NOT_PUBLISHABLE` 400 (`toolIds`), `TOOLSET_SHARING_REFUSED` 409,
 * `TOOLSET_LIMIT_EXCEEDED` 429.
 */
export function publishToolset(id: string, body: { visibility: ToolsetVisibility; changelog?: string }): Promise<PublishResult> {
  return api.post<PublishResult>(`/toolsets/${encodeURIComponent(id)}/publish`, body);
}

/** Stop sharing: old shared URLs serve the last version for 90 days. */
export function unpublishToolset(id: string): Promise<PublishResult> {
  return api.post<PublishResult>(`/toolsets/${encodeURIComponent(id)}/unpublish`, {});
}

/** A new link; the old one stops working at once. */
export function rotateUnlistedToken(id: string): Promise<PublishResult> {
  return api.post<PublishResult>(`/toolsets/${encodeURIComponent(id)}/unlisted-token/rotate`, {});
}

/** Newest first. Own tool sets only. */
export function listToolsetVersions(id: string): Promise<ToolsetVersionSummary[]> {
  return api.get<ToolsetVersionSummary[]>(`/toolsets/${encodeURIComponent(id)}/versions`);
}

export function getToolsetVersion(id: string, version: number): Promise<ToolsetVersion> {
  return api.get<ToolsetVersion>(`/toolsets/${encodeURIComponent(id)}/versions/${version}`);
}

/** Make my own version. 404 also when the caller cannot see the source. */
export function copyToolset(id: string, body: { version?: number; unlistedToken?: string; name?: string }): Promise<CopyResult> {
  return api.post<CopyResult>(`/toolsets/${encodeURIComponent(id)}/copy`, body);
}

/** The publisher dashboard: weekly, k = 5 on every cell. Own tool sets only. */
export function getToolsetStats(id: string): Promise<ToolsetOwnStats> {
  return api.get<ToolsetOwnStats>(`/toolsets/${encodeURIComponent(id)}/stats`);
}

/* ------------------------------------------------------- public name */

export interface OrgHandle {
  handle: string | null;
  status: "ACTIVE" | "FROZEN" | null;
  /** Set by the first shared tool set. */
  lockedAt: string | null;
  /** It can be claimed or changed here (not locked or frozen). */
  canChange: boolean;
}

export function getOrgHandle(): Promise<OrgHandle> {
  return api.get<OrgHandle>("/org/handle");
}

/**
 * Claim or change the public name. Errors: `TOOLSET_HANDLE_INVALID` 400
 * (`reason` FORMAT | RESERVED), `TOOLSET_HANDLE_TAKEN` 409 (`suggestions`),
 * `TOOLSET_HANDLE_LOCKED` 409, `TOOLSET_HANDLE_CLAIM_REFUSED` 403 (`reason`
 * NOT_VERIFIED | CLAIM_LIMIT).
 */
export function claimOrgHandle(handle: string): Promise<OrgHandle> {
  return api.put<OrgHandle>("/org/handle", { handle });
}

/* ----------------------------------------------------------- reports */

/** Exactly one of `toolsetId`, `toolId`, `handle`. Errors: `TOOLSET_REPORT_DUPLICATE` 409. */
export function createReport(body: { toolsetId?: string; toolId?: string; handle?: string; unlistedToken?: string; reason: string }): Promise<{ id: string; createdAt: string }> {
  return api.post<{ id: string; createdAt: string }>("/reports", body);
}

/* ---------------------------------------------- what this agent can use */

export interface AllowedToolset {
  toolsetId: string;
  version: number | null;
  viaUrlOnly: boolean;
  name: string | null;
  slug: string | null;
  deleted: boolean;
  /** T2. The owner's public name; `assay` for Official. */
  handle?: string | null;
  /** T2. Owned by your organization. */
  own?: boolean;
  /** T2. NOT_SHARED: its owner stopped sharing it; REMOVED: taken down. */
  status?: "ACTIVE" | "DELETED" | "NOT_SHARED" | "REMOVED";
  /** T2. The newest version the pin could move to — the "Update available" chip. */
  latestVersion?: number | null;
}

export interface AgentRules {
  excludeProviderIds: string[];
  maxPrice: Money | null;
  minTier: ProviderTier | null;
  minQuality: number | null;
}

export interface AgentToolEffect {
  toolId: string;
  name: string;
  category: string;
  access: ToolAccessStanding;
  providersTotal: number;
  providersLeft: number;
}

export interface AgentAccess {
  agentId: string;
  scope: "AGENT" | "ORGANIZATION" | "DEFAULT";
  policyVersion: number | null;
  accessMode: AccessMode;
  allowedToolsets: AllowedToolset[];
  allowedToolIds: string[];
  rules: AgentRules;
  pinnedTools: string[];
  tools: AgentToolEffect[];
}

export interface OnlyConnectedResult extends AgentAccess {
  /** One of the servers in use is `/` with no filter: "only what's connected" means everything. */
  everything: boolean;
}

/** `PATCH /agents/:agentId/access`. Omitted fields keep their value. */
export interface UpdateAgentAccessBody {
  accessMode?: AccessMode;
  /**
   * Another organization's tool set must be pinned to a version; `null`
   * (always latest) is allowed only for your own and Official ones.
   */
  allowedToolsets?: { toolsetId: string; version: number | null; viaUrlOnly: boolean; unlistedToken?: string }[];
  allowedToolIds?: string[];
  rules?: {
    excludeProviderIds?: string[];
    /** Atomic units of the spend policy's own asset; `null` removes the limit. */
    maxPrice?: string | null;
    minTier?: ProviderTier | null;
    minQuality?: number | null;
  };
  pinnedTools?: string[];
  changeReason?: string;
}

export function getAgentAccess(agentId: string): Promise<AgentAccess> {
  return api.get<AgentAccess>(`/agents/${encodeURIComponent(agentId)}/access`);
}

export function updateAgentAccess(agentId: string, body: UpdateAgentAccessBody): Promise<AgentAccess> {
  return api.patch<AgentAccess>(`/agents/${encodeURIComponent(agentId)}/access`, body);
}

export function restrictToConnected(agentId: string): Promise<OnlyConnectedResult> {
  return api.post<OnlyConnectedResult>(`/agents/${encodeURIComponent(agentId)}/access/only-connected`, {});
}

/* ------------------------------------------------ preview and servers */

export type PreviewWarningCode = "NO_BACKUP_PROVIDER" | "BLOCKED_BY_ACCESS" | "NOTHING_ALLOWED" | "NO_PROVIDER_FITS" | "IGNORED_TOOLS";

export interface PreviewTool {
  toolId: string;
  name: string;
  category: string;
  /** Returned by `tools/list` for this agent. */
  listed: boolean;
  allowed: boolean;
  pricingMode: "FREE" | "FREEMIUM" | "PAID" | null;
  /** The display price, e.g. "up to $0.01"; `null` when unpriced. */
  price: string | null;
  providerCount: number;
  noProviderFits: boolean;
  /**
   * Why this agent cannot run it here: the rules removed every provider
   * (`RULES`), or it has a paid price but no provider settles on the agent's
   * own chain (`OTHER_CHAIN`; a FREEMIUM tool still serves its free calls).
   * `null` when it can run.
   */
  noFitReason?: NoFitReason | null;
}

export type NoFitReason = "RULES" | "OTHER_CHAIN";

/** A tool a preview warning is about; `toolId` is null for an ignored `?tools=` name. */
export interface PreviewWarningTool {
  toolId: string | null;
  name: string;
}

export interface McpUrlPreview {
  canonicalUrl: string;
  endpointKind: EndpointKind;
  toolsetId: string | null;
  toolsetName: string | null;
  viewFilter: Record<string, unknown> | null;
  discovery: "FULL" | "SEARCH";
  listedCount: number;
  /** T2. Tools this agent can reach here: listed, or through search. */
  reachableCount?: number;
  /** T2. The names `tools/list` returns, in order (search mode: pinned + the 3 search tools). */
  listedTools?: string[];
  estimatedTokens: number;
  freeOnly: boolean;
  tools: PreviewTool[];
  ignoredTools: string[];
  warnings: { code: PreviewWarningCode | string; tools: PreviewWarningTool[] }[];
}

/** Errors: 400 `URL_NOT_RECOGNISED`, 404 `MCP_URL_NOT_FOUND`. */
export function previewMcpUrl(body: { url: string; agentId: string }): Promise<McpUrlPreview> {
  return api.post<McpUrlPreview>("/mcp-urls/preview", body);
}

export interface ServerInUse {
  canonicalUrl: string;
  endpointKind: EndpointKind;
  toolsetId: string | null;
  name: string;
  serverName: string | null;
  client: string | null;
  /** `null` when the URL no longer serves (a deleted set). */
  toolCount: number | null;
  estimatedTokens: number | null;
  discovery: "FULL" | "SEARCH";
  /** T2. For a server that shows every tool: the same URL in search mode ("Switch to search"). */
  searchUrl?: string | null;
  lastCallAt: string | null;
  handedOutAt: string | null;
  firstCallAt: string | null;
  waitingForFirstCall: boolean;
  available: boolean;
  updateAvailable: boolean;
  /** Set only when `updateAvailable`: the newest version this URL's path serves. */
  latestVersion?: number | null;
  /** This URL at `latestVersion`, for "Copy v4 URL"; set only when `updateAvailable`. */
  latestUrl?: string | null;
}

export interface ServersInUse {
  servers: ServerInUse[];
  /** The servers that show every tool list more than 25 tools between them. */
  overBudget: boolean;
}

export function listAgentServers(agentId: string): Promise<ServersInUse> {
  return api.get<ServersInUse>(`/agents/${encodeURIComponent(agentId)}/servers`);
}

/** Remembers a URL the Connect sheet handed out, for "Waiting for the first call" and the remembered tab. */
export function recordConnectUrl(
  agentId: string,
  body: { url: string; serverName?: string; client?: ConnectClient },
): Promise<ServerInUse> {
  return api.post<ServerInUse>(`/agents/${encodeURIComponent(agentId)}/connect-urls`, body);
}

/* ------------------------------------------------------- refused calls */

export interface RefusedProvider {
  providerId: string;
  /** The provider's name, also after it was delisted; null when unknown. */
  providerName: string | null;
  /** …, T3: MISSING_OUTPUT_FIELD | UNSUPPORTED_INPUT_FIELD | CONTRACT_VERSION_MISMATCH. */
  reason: string;
  /** Whose rule dropped it; T3 adds REQUEST (the call's own arguments) and MIGRATION (a contract version the binding does not serve). */
  source: "AGENT" | "TOOLSET" | "REQUEST" | "MIGRATION" | string;
  /** T3: on MISSING_OUTPUT_FIELD and UNSUPPORTED_INPUT_FIELD, the fields. */
  fields?: string[];
  /** T3, CONTRACT_VERSION_MISMATCH: the majors the binding serves, e.g. [1]. */
  servedMajors?: number[];
  /** T3, CONTRACT_VERSION_MISMATCH: the major the call was routed at. */
  requestedMajor?: number;
  /** T3, CONTRACT_VERSION_MISMATCH: the majors the call may use; null when unconstrained. */
  requestedRange?: number[] | null;
  detail: string;
  rule?: string;
}

export interface RefusedCall {
  callId: string;
  agentId: string;
  toolId: string | null;
  toolName: string | null;
  refusalCode: string;
  refusalLayer: RefusalLayer;
  charged: false;
  providers: RefusedProvider[];
  endpointKind: EndpointKind | null;
  toolsetId: string | null;
  toolsetVersion: number | null;
  viewFilter: Record<string, unknown> | null;
  createdAt: string;
  /** T3: per code. On CONTRACT_VERSION_RETIRED, what replaces it (null when nothing does). */
  details?: { replacement?: RefusedCallReplacement | null };
}

/** What to call instead of a retired contract version (`RefusedCallReplacementDto`). */
export interface RefusedCallReplacement {
  /** Another tool, or the same tool at another major. */
  toolId: string;
  name: string;
  major: number | null;
  semver: string | null;
  /** As the agent was told, e.g. `get_weather@2 (v2.0.0)`. */
  label: string;
}

export function listRefusedCalls(query: ListQuery & { agentId?: string } = {}): Promise<CursorPage<RefusedCall>> {
  return api.get<CursorPage<RefusedCall>>("/refused-calls", query as Record<string, unknown>);
}

/** 404 `TOOLSET_REFUSED_CALL_NOT_FOUND`, also for another organization's call. */
export function getRefusedCall(callId: string): Promise<RefusedCall> {
  return api.get<RefusedCall>(`/refused-calls/${encodeURIComponent(callId)}`);
}
