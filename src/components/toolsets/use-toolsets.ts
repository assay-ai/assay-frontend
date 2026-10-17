"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import {
  getAgentAccess,
  getToolset,
  listAgentServers,
  listToolsets,
  previewMcpUrl,
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
};

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

/** The plain sentence for a failed request. */
export function errorText(error: unknown, fallback = "Something went wrong. Try again."): string {
  return error instanceof ApiError ? plainError(error.code) : fallback;
}
