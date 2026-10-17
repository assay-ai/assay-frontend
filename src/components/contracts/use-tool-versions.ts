"use client";

import { useQuery } from "@tanstack/react-query";

import type { ToolVersionList } from "@/interfaces/contracts";
import { getCatalogueToolVersions } from "@/services/catalogue.service";
import { getPublicToolVersions } from "@/services/public-explorer.service";

/**
 * A tool's published contract versions (`GET /catalogue/tools/:id/versions`,
 * or the public twin when signed out). Cached per tool: the editor rows and
 * the tool pages ask for the same list.
 */
export function useToolVersions(toolId: string | null | undefined, options: { public?: boolean; enabled?: boolean } = {}) {
  return useQuery<ToolVersionList>({
    queryKey: ["catalogue", "tool-versions", options.public ? "public" : "signed-in", toolId ?? ""],
    queryFn: () => (options.public ? getPublicToolVersions(toolId!) : getCatalogueToolVersions(toolId!)),
    enabled: Boolean(toolId) && options.enabled !== false,
    retry: false,
    staleTime: 60_000,
  });
}
