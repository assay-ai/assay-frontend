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
export type ConnectClient = "claude-code" | "claude-desktop" | "cursor" | "other";

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
}

export interface ToolsetEntry extends Omit<ToolsetEntryInput, "maxPrice"> {
  position: number;
  toolName: string;
  category: string;
  maxPrice: Money | null;
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

/* ---------------------------------------------- what this agent can use */

export interface AllowedToolset {
  toolsetId: string;
  version: number | null;
  viaUrlOnly: boolean;
  name: string | null;
  slug: string | null;
  deleted: boolean;
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
  allowedToolsets?: { toolsetId: string; version: null; viaUrlOnly: boolean }[];
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
}

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
  lastCallAt: string | null;
  handedOutAt: string | null;
  firstCallAt: string | null;
  waitingForFirstCall: boolean;
  available: boolean;
  updateAvailable: boolean;
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
  reason: string;
  source: "AGENT" | "TOOLSET" | string;
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
}

export function listRefusedCalls(query: ListQuery & { agentId?: string } = {}): Promise<CursorPage<RefusedCall>> {
  return api.get<CursorPage<RefusedCall>>("/refused-calls", query as Record<string, unknown>);
}

/** 404 `TOOLSET_REFUSED_CALL_NOT_FOUND`, also for another organization's call. */
export function getRefusedCall(callId: string): Promise<RefusedCall> {
  return api.get<RefusedCall>(`/refused-calls/${encodeURIComponent(callId)}`);
}
