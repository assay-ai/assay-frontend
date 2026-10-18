import type { AgentAccess, UpdateAgentAccessBody } from "@/services/toolsets.service";

/**
 * Allow / Block a tool from Explore, writing the same "What this agent can
 * use" as the Agents page (`PATCH /agents/:id/access`). Everything allows
 * every tool; Only these allows the listed tools and tool sets. The server
 * refuses a call to anything else before any money moves, whatever URL the
 * call arrives through.
 *
 * There is no block list, so blocking one tool while the agent can use
 * everything turns its access into "Only these": every tool known today minus
 * that one — and a tool listed later is then not allowed until someone allows
 * it. `blockSwitchesToList` says when that happens, so the screen can say so
 * before it writes.
 */

export type ToolAccess = "allowed" | "blocked" | "via-toolset";

export function toolAccess(access: AgentAccess | null | undefined, toolId: string): ToolAccess {
  if (!access || access.accessMode === "ALL") return "allowed";
  if (access.allowedToolIds.includes(toolId)) return "allowed";
  const standing = access.tools.find((t) => t.toolId === toolId)?.access;
  if (standing === "ALLOWED") return "allowed";
  if (standing === "VIA_TOOLSET_URL") return "via-toolset";
  return "blocked";
}

export function blockSwitchesToList(access: AgentAccess | null | undefined): boolean {
  return !access || access.accessMode === "ALL";
}

/**
 * The PATCH body for allowing or blocking `toolId`, or `undefined` when
 * nothing changes (already in that state, or allowed through a tool set,
 * which this one-tool switch does not edit).
 */
export function nextAccessBody(access: AgentAccess, toolId: string, toolName: string, allow: boolean): UpdateAgentAccessBody | undefined {
  const all = access.accessMode === "ALL";
  if (allow) {
    if (all || access.allowedToolIds.includes(toolId)) return undefined;
    return { allowedToolIds: [...access.allowedToolIds, toolId], changeReason: `Allowed ${toolName} from Explore` };
  }
  if (all) {
    return {
      accessMode: "RESTRICTED",
      allowedToolIds: access.tools.map((t) => t.toolId).filter((id) => id !== toolId),
      changeReason: `Blocked ${toolName} from Explore`,
    };
  }
  if (!access.allowedToolIds.includes(toolId)) return undefined;
  return { allowedToolIds: access.allowedToolIds.filter((id) => id !== toolId), changeReason: `Blocked ${toolName} from Explore` };
}

/** The line shown after a change: "prod can use 9 of 11 tools". */
export function accessSummary(access: AgentAccess | null | undefined, agentName: string): string {
  if (!access || access.accessMode === "ALL") return `${agentName} can use every tool, including new ones.`;
  const usable = access.tools.filter((t) => t.access !== "BLOCKED").length;
  const total = access.tools.length;
  if (usable === 0) return `${agentName} cannot use any tool.`;
  return `${agentName} can use ${usable} of ${total} ${total === 1 ? "tool" : "tools"}. New tools need allowing.`;
}
