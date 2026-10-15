"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import type { CatalogueTool, ToolCatalogue } from "@/interfaces";
import { listToolCatalogue } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Bindings by the tool they serve, not by id. Every provider surface that
 * names a binding — the rail, home, the tool list, a binding's title,
 * penalties, money — reads the name here, from the provider catalogue
 * (`GET /providers/me/tool-bindings/catalogue`, one cached request shared
 * under the query key the tool list already used).
 *
 *   const names = useProviderToolNames();
 *   names.toolName(binding.toolId)            // "Market quote", or null until it loads
 *   names.bindingLabel(binding)               // name, else the endpoint's host
 *   <ToolName toolId={binding.toolId} />      // name, or a short-id copy chip
 */

export const PROVIDER_CATALOGUE_KEY = ["provider", "tool-catalogue"] as const;

export function useProviderCatalogue() {
  return useQuery<ToolCatalogue>({
    queryKey: PROVIDER_CATALOGUE_KEY,
    queryFn: listToolCatalogue,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Tools seeded for tests carry "DEMO FIXTURE — DO NOT CALL" in their name or
 * description. They must never be offered to a provider as something to list.
 */
export function isFixtureTool(tool: Pick<CatalogueTool, "name" | "description">): boolean {
  return /demo fixture|do not call/i.test(`${tool.name} ${tool.description ?? ""}`);
}

export interface BindingLike {
  toolId: string;
  endpoint?: string | null;
}

export function useProviderToolNames() {
  const catalogue = useProviderCatalogue();
  const byId = React.useMemo(() => {
    const map = new Map<string, CatalogueTool>();
    for (const tool of catalogue.data?.tools ?? []) map.set(tool.id, tool);
    return map;
  }, [catalogue.data]);

  const toolName = React.useCallback((toolId: string | null | undefined): string | null => {
    if (!toolId) return null;
    const name = byId.get(toolId)?.name?.trim();
    return name ? name : null;
  }, [byId]);

  /** The tool's name; before it loads (or if unknown) the endpoint's host; never a uuid. */
  const bindingLabel = React.useCallback(
    (binding: BindingLike): string =>
      toolName(binding.toolId) ?? (binding.endpoint ? labelForEndpoint(binding.endpoint) : "Your tool"),
    [toolName],
  );

  return {
    toolName,
    bindingLabel,
    tool: (toolId: string) => byId.get(toolId) ?? null,
    isPending: catalogue.isPending,
    catalogue: catalogue.data ?? null,
  };
}

/** A tool's name, or its id as a copy chip when the catalogue does not know it. */
export function ToolName({
  toolId,
  endpoint,
  className,
  copyable = true,
}: {
  toolId: string;
  endpoint?: string | null;
  className?: string;
  /** False inside links and buttons (a button inside one is invalid HTML). */
  copyable?: boolean;
}) {
  const names = useProviderToolNames();
  const name = names.toolName(toolId);
  if (name) return <span className={className}>{name}</span>;
  if (endpoint) return <span className={className}>{labelForEndpoint(endpoint)}</span>;
  if (names.isPending) return <span className={cn("text-03", className)}>…</span>;
  return copyable ? <CopyChip value={toolId} /> : <span className={className}>Unknown tool</span>;
}
