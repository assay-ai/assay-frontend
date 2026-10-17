import type { Money } from "@/interfaces";
import type { AgentAccess, AgentRules, AgentToolEffect, UpdateAgentAccessBody } from "@/services/toolsets.service";
import { formatMoney } from "@/utils/money";

/**
 * "What this agent can use" (design spec §7.10): the combined result per
 * tool, and the PATCH bodies the one-click changes send. Pure, so the copy
 * and the bodies are tested without React.
 */

/** "$0.01": a price limit as people read it, to four places when it needs them. */
export function priceText(money: Money | null): string | null {
  if (!money) return null;
  const four = formatMoney(money, { decimals: 4 });
  // Trim trailing zeros past the cents: $0.0100 → $0.01, $0.0025 stays.
  return four.replace(/(\.\d\d\d*?)0+$/, "$1");
}

/** The agent's provider limits, as short phrases: ["max $0.01", "only verified", "2 providers excluded"]. */
export function limitPhrases(rules: AgentRules): string[] {
  const phrases: string[] = [];
  const max = priceText(rules.maxPrice);
  if (max) phrases.push(`max ${max}`);
  if (rules.minTier === "ESTABLISHED") phrases.push("only verified");
  if (rules.minTier === "TRUSTED") phrases.push("only trusted");
  const excluded = rules.excludeProviderIds.length;
  if (excluded > 0) phrases.push(`${excluded} provider${excluded === 1 ? "" : "s"} excluded`);
  return phrases;
}

/**
 * One tool's combined result, e.g. "get_weather: 2 of 4 providers left (your
 * limit: max $0.01)". Access first: a blocked tool says so, whatever its
 * providers; a tool nobody serves says that instead of "0 of 0".
 */
export function toolResultLine(tool: AgentToolEffect, rules: AgentRules): string {
  if (tool.access === "BLOCKED") return `${tool.name}: not allowed`;
  const via = tool.access === "VIA_TOOLSET_URL" ? " (only through its tool set's URL)" : "";
  if (tool.providersTotal === 0) return `${tool.name}: no provider serves it yet${via}`;
  const limits = limitPhrases(rules);
  const limitNote = limits.length > 0 ? ` (your limit${limits.length > 1 ? "s" : ""}: ${limits.join(", ")})` : "";
  if (tool.providersLeft === 0) return `${tool.name}: no provider fits${limitNote}${via}`;
  if (tool.providersLeft === tool.providersTotal) {
    return tool.providersTotal === 1
      ? `${tool.name}: 1 provider, no backup${via}`
      : `${tool.name}: all ${tool.providersTotal} providers${via}`;
  }
  return `${tool.name}: ${tool.providersLeft} of ${tool.providersTotal} providers left${limitNote}${via}`;
}

export type ToolResultTone = "ok" | "warn" | "blocked";

export function toolResultTone(tool: AgentToolEffect): ToolResultTone {
  if (tool.access === "BLOCKED") return "blocked";
  if (tool.providersLeft === 0 || tool.providersLeft === 1) return "warn";
  return "ok";
}

/** "Can use 7 of 12 tools" — the one-line summary over the per-tool list. */
export function accessSummary(access: AgentAccess): string {
  if (access.accessMode === "ALL") {
    const fits = access.tools.filter((t) => t.providersLeft > 0).length;
    return access.tools.length === 0
      ? "Can use every tool, including new ones."
      : `Can use every tool, including new ones. ${fits} of ${access.tools.length} have a provider that fits its limits.`;
  }
  const usable = access.tools.filter((t) => t.access !== "BLOCKED").length;
  if (usable === 0) return "Can use no tool at all: allow a tool set or a tool below.";
  return `Can use ${usable} of ${access.tools.length} tools.`;
}

/** The allowed tool sets as the PATCH body spells them (the names stay server-side). */
function toolsetRefs(access: AgentAccess): NonNullable<UpdateAgentAccessBody["allowedToolsets"]> {
  return access.allowedToolsets.map((t) => ({ toolsetId: t.toolsetId, version: null, viaUrlOnly: t.viaUrlOnly }));
}

/** "[Allow them]": these tools join the allowed list. Nothing to send when access is Everything. */
export function allowToolsBody(access: AgentAccess, toolIds: readonly string[], toolNames?: readonly string[]): UpdateAgentAccessBody | null {
  if (access.accessMode === "ALL") return null;
  const next = [...new Set([...access.allowedToolIds, ...toolIds])];
  if (next.length === access.allowedToolIds.length) return null;
  const named = toolNames && toolNames.length > 0 ? toolNames.join(", ") : `${toolIds.length} tool${toolIds.length === 1 ? "" : "s"}`;
  return { allowedToolIds: next, changeReason: `Allowed ${named}` };
}

export function removeToolBody(access: AgentAccess, toolId: string, toolName: string): UpdateAgentAccessBody {
  return { allowedToolIds: access.allowedToolIds.filter((id) => id !== toolId), changeReason: `Stopped allowing ${toolName}` };
}

export function addToolsetBody(access: AgentAccess, toolsetId: string, name: string): UpdateAgentAccessBody {
  if (access.allowedToolsets.some((t) => t.toolsetId === toolsetId)) return { changeReason: `Allowed ${name}` };
  return {
    allowedToolsets: [...toolsetRefs(access), { toolsetId, version: null, viaUrlOnly: true }],
    changeReason: `Allowed the tool set ${name}`,
  };
}

export function removeToolsetBody(access: AgentAccess, toolsetId: string, name: string): UpdateAgentAccessBody {
  return {
    allowedToolsets: toolsetRefs(access).filter((t) => t.toolsetId !== toolsetId),
    changeReason: `Stopped allowing the tool set ${name}`,
  };
}

export function viaUrlOnlyBody(access: AgentAccess, toolsetId: string, viaUrlOnly: boolean): UpdateAgentAccessBody {
  return {
    allowedToolsets: toolsetRefs(access).map((t) => (t.toolsetId === toolsetId ? { ...t, viaUrlOnly } : t)),
    changeReason: viaUrlOnly ? "Tool set allowed only through its own URL" : "Tool set allowed through any URL",
  };
}

/**
 * Everything ↔ Only these. Switching to Only these from Everything keeps
 * nothing implicit: it starts from the tools the agent can use now that have
 * a provider (so one click does not cut the agent off from everything).
 */
export function modeBody(access: AgentAccess, mode: "ALL" | "RESTRICTED"): UpdateAgentAccessBody {
  if (mode === "ALL") return { accessMode: "ALL", changeReason: "Allowed every tool" };
  const seeded = access.allowedToolIds.length > 0 || access.allowedToolsets.length > 0;
  return {
    accessMode: "RESTRICTED",
    ...(seeded ? {} : { allowedToolIds: access.tools.filter((t) => t.providersTotal > 0).map((t) => t.toolId) }),
    changeReason: "Allowed only chosen tool sets and tools",
  };
}

export function excludeProviderBody(rules: AgentRules, providerId: string, name: string): UpdateAgentAccessBody {
  return {
    rules: { excludeProviderIds: [...new Set([...rules.excludeProviderIds, providerId])] },
    changeReason: `Excluded the provider ${name}`,
  };
}

/** "Remove from limits": the provider may serve this agent again. */
export function includeProviderBody(rules: AgentRules, providerId: string, name: string): UpdateAgentAccessBody {
  return {
    rules: { excludeProviderIds: rules.excludeProviderIds.filter((id) => id !== providerId) },
    changeReason: `Removed ${name} from the provider limits`,
  };
}

export function verifiedOnlyBody(on: boolean): UpdateAgentAccessBody {
  return { rules: { minTier: on ? "ESTABLISHED" : null }, changeReason: on ? "Only verified providers" : "Any provider tier" };
}

export function maxPriceBody(atomic: string | null): UpdateAgentAccessBody {
  return { rules: { maxPrice: atomic }, changeReason: atomic === null ? "Removed the max price" : "Set a max price per call" };
}
