"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import type { CatalogueTool, ToolCatalogue } from "@/interfaces";
import { listToolCatalogue } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";

/**
 * Bindings by the tool they serve, not by id. Every provider surface that
 * names a binding — the rail, home, the tool list, a binding's title,
 * penalties, money — reads the name here, from the provider catalogue
 * (`GET /providers/me/tool-bindings/catalogue`, one cached request shared
 * under the query key the tool list already used).
 *
 *   const names = useProviderToolNames();
 *   names.toolName(binding.toolId)            // "Market quote", or null until it loads
 *   names.bindingLabel(binding)               // name, else "…" while loading, else "Removed tool (draft)" / "Unknown tool"
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
  /** A draft whose tool left the catalogue is named as such (V1-9). */
  status?: string;
}

/** A draft for a tool the catalogue no longer has: it can't go live, only be discarded. */
export const REMOVED_TOOL_DRAFT = "Removed tool (draft)";

/**
 * A listing's label: the tool's name, "…" while the catalogue loads, else
 * "Removed tool (draft)" for a draft missing from a catalogue that LOADED,
 * or "Unknown tool". A failed catalogue read proves nothing was removed, so
 * it never says so: that could lead a provider to discard a valid draft.
 * Never the endpoint: a host or an IP address is infrastructure, not a name,
 * and it is the same for every listing on one API.
 */
export function bindingLabelOf(toolName: string | null, pending: boolean, status?: string, loaded = false): string {
  if (toolName) return toolName;
  if (pending) return "…";
  return status === "DRAFT" && loaded ? REMOVED_TOOL_DRAFT : "Unknown tool";
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

  /** The tool's name; never a uuid, a host or an IP address. */
  const bindingLabel = React.useCallback(
    (binding: BindingLike): string =>
      bindingLabelOf(toolName(binding.toolId), catalogue.isPending, binding.status, catalogue.isSuccess),
    [toolName, catalogue.isPending, catalogue.isSuccess],
  );

  return {
    toolName,
    bindingLabel,
    tool: (toolId: string) => byId.get(toolId) ?? null,
    isPending: catalogue.isPending,
    /** The catalogue was read: only then is a tool missing from it known to be gone. */
    loaded: catalogue.isSuccess,
    catalogue: catalogue.data ?? null,
  };
}

/** A tool's name, or its id as a copy chip when the catalogue does not know it. */
export function ToolName({
  toolId,
  className,
  copyable = true,
}: {
  toolId: string;
  className?: string;
  /** False inside links and buttons (a button inside one is invalid HTML). */
  copyable?: boolean;
}) {
  const names = useProviderToolNames();
  const name = names.toolName(toolId);
  if (name) return <span className={className}>{name}</span>;
  if (names.isPending) return <span className={cn("text-03", className)}>…</span>;
  return copyable ? <CopyChip value={toolId} /> : <span className={className}>Unknown tool</span>;
}
