"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { listTools, type CatalogueTool } from "@/services/tools.service";

/**
 * `toolId` → the name a person recognises.
 *
 * ## Why this is a hook and not a field on the call
 *
 * `/tool-calls` returns `toolId` and nothing else about the tool, and it is
 * right not to: a call row is a financial record, and denormalising a display
 * label onto thousands of them means a renamed tool rewrites history. The
 * catalogue is small, platform-wide and identical for every caller, so the
 * join belongs on the client, once.
 *
 * ## It never blocks and never breaks a screen
 *
 * Every consumer goes through {@link nameOf}, which falls back to the id. So a
 * screen renders immediately with uuids and swaps in names when the catalogue
 * lands; and a catalogue that 500s or times out leaves every screen exactly
 * as it was before this existed. `retry: false` for the same reason — a failed catalogue is a
 * cosmetic loss, not something to hammer the API over.
 *
 * `staleTime: Infinity` because the tool contracts are seeded and change on a
 * deploy, not during a session. `gcTime` is left at the default: the point is
 * to avoid refetching, not to pin memory.
 */
/**
 * `CatalogueTool[]` → an index by id.
 *
 * Exported, and pure, so the fallback rule below is testable without mounting
 * React. A duplicate id keeps the **last** entry — the catalogue is a map on
 * the server too, so a duplicate would be a server bug; last-wins is simply
 * what `Map` does and pretending to have a policy here would be fiction.
 */
export function toolNameIndex(tools: readonly CatalogueTool[]): Map<string, CatalogueTool> {
  const map = new Map<string, CatalogueTool>();
  for (const tool of tools) map.set(tool.id, tool);
  return map;
}

/**
 * The name, or the id when there is no name to give.
 *
 * The id is the honest fallback rather than "Unknown tool": a call whose tool
 * has been removed from the catalogue still happened, still cost money, and
 * its id is what a receipt, a log line and the ⌘K search all take. Printing a
 * placeholder would break the one thing the uuid was good for.
 *
 * An empty index is the normal state for the first render and for every render
 * after a failed fetch, so this is the path most calls take.
 */
export function nameFrom(index: Map<string, CatalogueTool>, toolId: string): string {
  return index.get(toolId)?.name ?? toolId;
}

export function useToolNames() {
  const query = useQuery({
    queryKey: ["tool-catalogue"],
    retry: false,
    staleTime: Infinity,
    queryFn: listTools,
  });

  const byId = React.useMemo(() => toolNameIndex(query.data?.tools ?? []), [query.data]);

  const nameOf = React.useCallback((toolId: string): string => nameFrom(byId, toolId), [byId]);

  const describe = React.useCallback(
    (toolId: string): string | null => byId.get(toolId)?.description ?? null,
    [byId]
  );

  /** True once a name is actually available — for a screen that wants to hold a skeleton. */
  const resolved = React.useCallback((toolId: string): boolean => byId.has(toolId), [byId]);

  return { nameOf, describe, resolved, isPending: query.isPending, byId };
}

/**
 * The id, shortened for the second line.
 *
 * Kept to the first segment of the uuid — enough to tell two rows apart and to
 * recognise one you have seen in a log, short enough not to compete with the
 * name above it. The full id stays in `title` at every call site, so a copy is
 * one hover away.
 */
export function shortToolId(toolId: string): string {
  const [head] = toolId.split("-");
  return head && head.length < toolId.length ? `${head}…` : toolId;
}
