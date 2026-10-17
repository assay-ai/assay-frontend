"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { McpClient } from "@/features/buyer-money/mcp-config";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import {
  getPublicHandle,
  getPublicToolset,
  getPublicToolsetVersion,
  getToolsetByToken,
  listPublicCategories,
  listPublicToolsets,
  listPublicToolsetVersions,
  type ListPublicToolsetsQuery,
} from "@/services/public-toolsets.service";
import {
  getAgentAccess,
  getOrgHandle,
  getToolsetStats,
  getToolsetVersion,
  listToolsetVersions,
  getToolset,
  listAgentServers,
  listToolsets,
  previewMcpUrl,
  recordConnectUrl,
  updateAgentAccess,
  type AgentAccess,
  type UpdateAgentAccessBody,
} from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

/**
 * The queries and the one write every tool-set screen shares, keyed so a
 * change in one place (allowing a tool from the Connect sheet) shows in the
 * others (What this agent can use, Servers in use) without a reload.
 */

export const toolsetKeys = {
  all: ["toolsets"] as const,
  one: (id: string) => ["toolsets", id] as const,
  access: (agentId: string) => ["agent-access", agentId] as const,
  servers: (agentId: string) => ["agent-servers", agentId] as const,
  preview: (url: string, agentId: string) => ["mcp-preview", agentId, url] as const,
  refused: (agentId?: string | null) => ["refused-calls", agentId ?? "all"] as const,
  versions: (id: string) => ["toolsets", id, "versions"] as const,
  version: (id: string, v: number) => ["toolsets", id, "versions", v] as const,
  stats: (id: string) => ["toolsets", id, "stats"] as const,
  handle: ["org-handle"] as const,
  publicList: (query: ListPublicToolsetsQuery) => ["public-toolsets", query] as const,
  publicPage: (handle: string, slug: string) => ["public-toolset", handle, slug] as const,
  publicVersions: (handle: string, slug: string) => ["public-toolset", handle, slug, "versions"] as const,
  byToken: (token: string, v: number | null, diffFrom: number | null = null) => ["public-toolset-token", token, v ?? "latest", diffFrom ?? "none"] as const,
  publicVersion: (handle: string, slug: string, v: number, diffFrom: number | null) => ["public-toolset", handle, slug, "versions", v, diffFrom ?? "none"] as const,
  publicHandle: (handle: string) => ["public-handle", handle] as const,
  categories: ["public-categories"] as const,
};

export function useOrgHandle(enabled = true) {
  return useQuery({ queryKey: toolsetKeys.handle, enabled, retry: false, queryFn: getOrgHandle });
}

export function useToolsetVersions(id: string | null | undefined, enabled = true) {
  return useQuery({ queryKey: toolsetKeys.versions(id ?? ""), enabled: Boolean(id) && enabled, retry: false, queryFn: () => listToolsetVersions(id!) });
}

export function useToolsetVersion(id: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: toolsetKeys.version(id ?? "", version ?? 0),
    enabled: Boolean(id && version),
    retry: false,
    staleTime: Infinity,
    queryFn: () => getToolsetVersion(id!, version!),
  });
}

export function useToolsetStats(id: string | null | undefined, enabled = true) {
  return useQuery({ queryKey: toolsetKeys.stats(id ?? ""), enabled: Boolean(id) && enabled, retry: false, queryFn: () => getToolsetStats(id!) });
}

export function usePublicToolsets(query: ListPublicToolsetsQuery, enabled = true) {
  return useQuery({
    queryKey: toolsetKeys.publicList(query),
    enabled,
    retry: false,
    staleTime: 30_000,
    // A new filter keeps the cards on screen until the answer lands, so the list never flashes empty.
    placeholderData: keepPreviousData,
    queryFn: () => listPublicToolsets(query),
  });
}

export function usePublicToolset(handle: string | null, slug: string | null) {
  return useQuery({
    queryKey: toolsetKeys.publicPage(handle ?? "", slug ?? ""),
    enabled: Boolean(handle && slug),
    retry: false,
    queryFn: () => getPublicToolset(handle!, slug!),
  });
}

export function usePublicToolsetVersions(handle: string | null, slug: string | null) {
  return useQuery({
    queryKey: toolsetKeys.publicVersions(handle ?? "", slug ?? ""),
    enabled: Boolean(handle && slug),
    retry: false,
    queryFn: () => listPublicToolsetVersions(handle!, slug!),
  });
}

export function useToolsetByToken(token: string | null, v: number | null, diffFrom: number | null = null) {
  return useQuery({
    queryKey: toolsetKeys.byToken(token ?? "", v, diffFrom),
    enabled: Boolean(token),
    retry: false,
    queryFn: () => getToolsetByToken(token!, v, diffFrom),
  });
}

/** One published version of a listed set, with the diff from `diffFrom` ("Update available"). */
export function usePublicToolsetVersion(handle: string | null, slug: string | null, v: number | null, diffFrom: number | null) {
  return useQuery({
    queryKey: toolsetKeys.publicVersion(handle ?? "", slug ?? "", v ?? 0, diffFrom),
    enabled: Boolean(handle && slug && v),
    retry: false,
    staleTime: 300_000,
    queryFn: () => getPublicToolsetVersion(handle!, slug!, v!, diffFrom),
  });
}

export function usePublicHandle(handle: string | null) {
  return useQuery({ queryKey: toolsetKeys.publicHandle(handle ?? ""), enabled: Boolean(handle), retry: false, queryFn: () => getPublicHandle(handle!) });
}

export function usePublicCategories() {
  return useQuery({ queryKey: toolsetKeys.categories, retry: false, staleTime: 300_000, queryFn: listPublicCategories });
}

export function useToolsets() {
  return useQuery({ queryKey: toolsetKeys.all, retry: false, queryFn: () => listToolsets() });
}

export function useToolset(id: string | null) {
  return useQuery({
    queryKey: toolsetKeys.one(id ?? ""),
    enabled: Boolean(id),
    retry: false,
    queryFn: () => getToolset(id!),
  });
}

export function useAgentAccess(agentId: string | null | undefined) {
  return useQuery({
    queryKey: toolsetKeys.access(agentId ?? ""),
    enabled: Boolean(agentId),
    retry: false,
    queryFn: () => getAgentAccess(agentId!),
  });
}

export function useAgentServers(agentId: string | null | undefined, options: { pollMs?: number | false } = {}) {
  return useQuery({
    queryKey: toolsetKeys.servers(agentId ?? ""),
    enabled: Boolean(agentId),
    retry: false,
    refetchInterval: options.pollMs ?? false,
    queryFn: () => listAgentServers(agentId!),
  });
}

/** What `tools/list` will return at `url` for this agent. Never fetched until both are known. */
export function useMcpPreview(url: string | null, agentId: string | null | undefined) {
  return useQuery({
    queryKey: toolsetKeys.preview(url ?? "", agentId ?? ""),
    enabled: Boolean(url && agentId),
    retry: false,
    staleTime: 15_000,
    queryFn: () => previewMcpUrl({ url: url!, agentId: agentId! }),
  });
}

/**
 * One change to what an agent can use. The answer is the new access, put
 * straight in the cache; previews and server rows depend on it, so they are
 * refetched.
 */
export function useUpdateAccess(agentId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAgentAccessBody) => updateAgentAccess(agentId!, body),
    onSuccess: (next: AgentAccess) => {
      queryClient.setQueryData(toolsetKeys.access(next.agentId), next);
      void queryClient.invalidateQueries({ queryKey: ["mcp-preview", next.agentId] });
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.servers(next.agentId) });
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "The change could not be saved"),
  });
}

/**
 * Remembers a URL handed out on copy (`POST /agents/:id/connect-urls`), so
 * Servers in use shows "Waiting for the first call" and the client tab is
 * remembered. Bookkeeping: a failure is silent, the copy already happened.
 */
export function useRecordConnect(agentId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; serverName?: string; client?: McpClient }) => recordConnectUrl(agentId!, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: toolsetKeys.servers(agentId ?? "") }),
  });
}

/** The plain sentence for a failed request. */
export function errorText(error: unknown, fallback = "Something went wrong. Try again."): string {
  return error instanceof ApiError ? plainError(error.code) : fallback;
}
