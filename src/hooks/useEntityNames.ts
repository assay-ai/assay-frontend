"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { listAgents, listCredentials } from "@/services/account.service";
import { listCatalogueProviders } from "@/services/catalogue.service";
import { listTools } from "@/services/tools.service";

/**
 * Ids → the names people recognise, for tools, providers, agents and agent
 * keys (credentials), from endpoints that already exist:
 *
 *   tool        GET /tools                       → `name`        (shared with useToolNames)
 *   provider    GET /catalogue/providers         → `legalName`   (shared with useCatalogue)
 *   agent       GET /agents                      → `label`       (shared with the Agents screen)
 *   credential  GET /agents/:id/credentials      → "<agent> · <key name>"
 *
 *   const names = useEntityNames();
 *   names.name("tool", call.toolId)          // "search_web", or the id until it loads
 *   <EntityName kind="tool" id={call.toolId} />   // name, or the id as a CopyChip
 *
 * Never blocks and never breaks a screen: every lookup falls back to the id,
 * so a screen renders at once and swaps names in as they land, and a failed
 * endpoint leaves it exactly as it was (ids in copy chips). Lists are fetched
 * only for the kinds asked for — pass `kinds` on a screen that only shows
 * tools, so it does not fetch every agent's keys.
 *
 * Buyer and provider sessions only (these endpoints need the Privy session,
 * not the operator token). A CSV should use `name()` for the label column and
 * keep the raw id in its own column.
 */

export type EntityKind = "tool" | "provider" | "agent" | "credential";

export interface EntitySources {
  tools?: readonly { id: string; name: string }[];
  providers?: readonly { providerId: string; legalName: string }[];
  agents?: readonly { agentId: string; label?: string | null }[];
  credentialsByAgent?: Readonly<Record<string, readonly { id: string; name?: string | null }[]>>;
}

export type EntityIndex = Record<EntityKind, Map<string, string>>;

/** Pure: the four lookups from whatever lists have arrived. Blank names are skipped. */
export function buildEntityIndex(sources: EntitySources): EntityIndex {
  const index: EntityIndex = { tool: new Map(), provider: new Map(), agent: new Map(), credential: new Map() };
  const put = (map: Map<string, string>, id: string, name: string | null | undefined) => {
    if (id && name && name.trim()) map.set(id, name.trim());
  };
  for (const tool of sources.tools ?? []) put(index.tool, tool.id, tool.name);
  for (const provider of sources.providers ?? []) put(index.provider, provider.providerId, provider.legalName);
  for (const agent of sources.agents ?? []) put(index.agent, agent.agentId, agent.label);
  for (const [agentId, credentials] of Object.entries(sources.credentialsByAgent ?? {})) {
    const agentName = index.agent.get(agentId);
    for (const credential of credentials) {
      const keyName = credential.name?.trim();
      const name = agentName && keyName ? `${agentName} · ${keyName}` : (keyName ?? agentName);
      put(index.credential, credential.id, name);
    }
  }
  return index;
}

/** The name, or `null` when there is none yet (the caller shows the id). */
export function entityName(index: EntityIndex, kind: EntityKind, id: string | null | undefined): string | null {
  if (!id) return null;
  return index[kind].get(id) ?? null;
}

const ALL_KINDS: readonly EntityKind[] = ["tool", "provider", "agent", "credential"];

export interface UseEntityNamesResult {
  /** The name, or the SHORT id ("06399979…") when no name is known — for text, titles and CSV. */
  name: (kind: EntityKind, id: string) => string;
  /** The name, or null — for a screen that wants to render the id differently (a CopyChip). */
  lookup: (kind: EntityKind, id: string | null | undefined) => string | null;
  /** True while any requested list is still loading. */
  isPending: boolean;
  index: EntityIndex;
}

export function useEntityNames(options: { kinds?: readonly EntityKind[] } = {}): UseEntityNamesResult {
  const kinds = options.kinds ?? ALL_KINDS;
  const wants = (kind: EntityKind) => kinds.includes(kind);
  const wantsAgents = wants("agent") || wants("credential");

  const tools = useQuery({
    queryKey: ["tool-catalogue"],
    queryFn: listTools,
    enabled: wants("tool"),
    retry: false,
    staleTime: Infinity,
  });
  const providers = useQuery({
    queryKey: ["catalogue", "providers"],
    queryFn: listCatalogueProviders,
    enabled: wants("provider"),
    retry: false,
    staleTime: 60_000,
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => listAgents({ limit: 50 }),
    enabled: wantsAgents,
    retry: false,
  });
  const agentIds = React.useMemo(() => (agents.data?.items ?? []).map((agent) => agent.agentId), [agents.data]);
  const credentials = useQuery({
    queryKey: ["entity-names", "credentials", agentIds],
    enabled: wants("credential") && agentIds.length > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const pages = await Promise.all(
        agentIds.map((id) =>
          (listCredentials(id, { limit: 50 }) as Promise<{ items: { id: string; name?: string | null }[] }>).catch(
            () => ({ items: [] }),
          ),
        ),
      );
      return Object.fromEntries(agentIds.map((id, i) => [id, pages[i]!.items]));
    },
  });

  const index = React.useMemo(
    () =>
      buildEntityIndex({
        tools: tools.data?.tools,
        providers: providers.data?.providers,
        agents: agents.data?.items,
        credentialsByAgent: credentials.data,
      }),
    [tools.data, providers.data, agents.data, credentials.data],
  );

  const lookup = React.useCallback(
    (kind: EntityKind, id: string | null | undefined) => entityName(index, kind, id),
    [index],
  );
  const name = React.useCallback((kind: EntityKind, id: string) => entityName(index, kind, id) ?? shortId(id), [index]);

  const isPending =
    (wants("tool") && tools.isPending) ||
    (wants("provider") && providers.isPending) ||
    (wantsAgents && agents.isPending) ||
    (wants("credential") && agentIds.length > 0 && credentials.isPending);

  return { name, lookup, isPending, index };
}
