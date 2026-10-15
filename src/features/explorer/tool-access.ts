/**
 * Allow / Block a tool from Explore, writing the same spend-policy allowlist as
 * Budgets (`/limits`): `allowedTools: null` allows every tool, a list allows
 * only those ids, `[]` allows none. The gateway refuses a call to a tool
 * outside the list before any money moves.
 *
 * There is no block list on the policy, so blocking one tool while every tool
 * is allowed turns the policy into an allow list of every tool known today
 * minus that one — and a tool listed later is then not allowed until someone
 * allows it. `blockSwitchesToList` says when that happens, so the screen can
 * say so before it writes.
 */

export type ToolAccess = "allowed" | "blocked";

export function toolAccess(allowedTools: readonly string[] | null | undefined, toolId: string): ToolAccess {
  if (allowedTools === null || allowedTools === undefined) return "allowed";
  return allowedTools.includes(toolId) ? "allowed" : "blocked";
}

export function blockSwitchesToList(allowedTools: readonly string[] | null | undefined): boolean {
  return allowedTools === null || allowedTools === undefined;
}

/** The next `allowedTools` after allowing or blocking `toolId`, or `undefined` when nothing changes. */
export function nextAllowedTools(
  current: readonly string[] | null | undefined,
  allToolIds: readonly string[],
  toolId: string,
  allow: boolean,
): string[] | null | undefined {
  const all = current === null || current === undefined;
  if (allow) {
    if (all || current.includes(toolId)) return undefined;
    const next = [...current, toolId];
    // Every known tool allowed again: go back to "every tool", so new tools are allowed too.
    return allToolIds.length > 0 && allToolIds.every((id) => next.includes(id)) ? null : next;
  }
  if (all) return allToolIds.filter((id) => id !== toolId);
  if (!current.includes(toolId)) return undefined;
  return current.filter((id) => id !== toolId);
}

/** The policy line shown after a change: "Your agents can use 9 of 11 tools". */
export function accessSummary(allowedTools: readonly string[] | null | undefined, total: number): string {
  if (allowedTools === null || allowedTools === undefined) return "Your agents can use every tool, including new ones.";
  if (allowedTools.length === 0) return "Your agents cannot use any tool.";
  const count = Math.min(allowedTools.length, total);
  return `Your agents can use ${count} of ${total} ${total === 1 ? "tool" : "tools"}. New tools need allowing.`;
}
