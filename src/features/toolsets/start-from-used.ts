/**
 * "Start from tools you've used": every tool the agents called recently, most
 * used first, each with whether it can run now. A tool with no live provider
 * is listed and tagged with the reason, never hidden: hiding it made the
 * tool set look like it lost tools (review F-P1).
 */
export type UsedToolState = "ready" | "no-provider" | "gone";

export interface UsedTool {
  toolId: string;
  name: string;
  calls: number;
  state: UsedToolState;
  /** Why it can't run now; null when it can. */
  reason: string | null;
  /** Ticked when the set is created. */
  defaultOn: boolean;
  /** A tool that is no longer on Assay cannot go in a set. */
  selectable: boolean;
}

export const USED_TOOL_REASONS: Record<Exclude<UsedToolState, "ready">, string> = {
  "no-provider": "no provider is taking calls for it now",
  gone: "no longer on Assay",
};

export function usedTools(
  calls: readonly { toolId: string }[],
  /** The catalogue: tools with a live listing, and whether a call would find a provider now. */
  listed: readonly { toolId: string; name: string; routable: boolean }[],
  /** Every tool on Assay by id (`GET /tools`); empty while it loads. */
  known: ReadonlyMap<string, { name: string }>,
  limit = 20,
): UsedTool[] {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.toolId, (counts.get(call.toolId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([toolId, n]) => {
      const row = listed.find((tool) => tool.toolId === toolId);
      const name = row?.name ?? known.get(toolId)?.name ?? toolId;
      // Not in the catalogue and unknown to `GET /tools` (once it has loaded): removed.
      const state: UsedToolState = row?.routable ? "ready" : row || known.has(toolId) || known.size === 0 ? "no-provider" : "gone";
      return {
        toolId,
        name,
        calls: n,
        state,
        reason: state === "ready" ? null : USED_TOOL_REASONS[state],
        defaultOn: state === "ready",
        selectable: state !== "gone",
      };
    });
}

/**
 * The address a new set gets: `base`, or `base-2`, `base-3`… when one of the
 * account's own sets has it (the server's own rule, `freeSlug`). The form
 * sends this slug, so the URL it shows is the one created; a slug taken by a
 * set the list does not show comes back as TOOLSET_SLUG_TAKEN with a free one.
 */
export function freeSlugAmong(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
