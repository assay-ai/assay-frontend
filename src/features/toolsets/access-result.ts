import type { Money } from "@/interfaces";
import type { AgentAccess, AgentRules, AgentToolEffect, AllowedToolset, UpdateAgentAccessBody } from "@/services/toolsets.service";
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
  if (tool.access === "BLOCKED") return `${tool.name}: not in this agent's list`;
  const via = tool.access === "VIA_TOOLSET_URL" ? " · only through its tool set's URL" : "";
  if (tool.providersTotal === 0) return `${tool.name}: no provider serves it yet${via}`;
  const limits = limitPhrases(rules);
  const limitNote = limits.length > 0 ? ` (your limit${limits.length > 1 ? "s" : ""}: ${limits.join(", ")})` : "";
  if (tool.providersLeft === 0) return `${tool.name}: no provider fits${limitNote}${via}`;
  if (tool.providersLeft === tool.providersTotal) {
    return tool.providersTotal === 1
      ? `${tool.name}: 1 provider, no backup${via}`
      : `${tool.name}: ${tool.providersTotal === 2 ? "both" : `all ${tool.providersTotal}`} providers${via}`;
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
  return access.allowedToolsets.map((t) => ({ toolsetId: t.toolsetId, version: t.version ?? null, viaUrlOnly: t.viaUrlOnly }));
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

/**
 * Allows a tool set. Another organization's must be locked to a version
 * (`version`); "always latest" (null) only for your own and Official ones.
 */
export function addToolsetBody(access: AgentAccess, toolsetId: string, name: string, version: number | null = null, unlistedToken?: string): UpdateAgentAccessBody {
  if (access.allowedToolsets.some((t) => t.toolsetId === toolsetId)) return { changeReason: `Allowed ${name}` };
  return {
    allowedToolsets: [...toolsetRefs(access), { toolsetId, version, viaUrlOnly: true, ...(unlistedToken ? { unlistedToken } : {}) }],
    changeReason: version ? `Allowed the tool set ${name}, locked to v${version}` : `Allowed the tool set ${name}`,
  };
}

/** "Move the lock to v4": the agent may use what v4 holds. Shown after the diff. */
export function moveLockBody(access: AgentAccess, toolsetId: string, version: number, name: string): UpdateAgentAccessBody {
  return {
    allowedToolsets: toolsetRefs(access).map((t) => (t.toolsetId === toolsetId ? { ...t, version } : t)),
    changeReason: `Moved ${name} to v${version}`,
  };
}

/** "Always loaded": at most 5 tool names, pinned on every search URL of this agent. */
export const MAX_ALWAYS_LOADED = 5;

export function pinnedToolsBody(names: readonly string[]): UpdateAgentAccessBody {
  const pinned = [...new Set(names)].slice(0, MAX_ALWAYS_LOADED);
  return { pinnedTools: pinned, changeReason: pinned.length ? `Always loaded: ${pinned.join(", ")}` : "No tools always loaded" };
}

/**
 * The tools to suggest for "Always loaded": the agent's most-called ones
 * first, then nothing else — a suggestion is only worth a click when it is
 * what the agent actually uses.
 */
export function suggestAlwaysLoaded(calls: readonly { toolName: string }[], current: readonly string[], allowed?: ReadonlySet<string>): string[] {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.toolName, (counts.get(call.toolName) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([name]) => !current.includes(name) && (!allowed || allowed.has(name)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .slice(0, MAX_ALWAYS_LOADED);
}

/** An allowed tool set with a newer version than the one it is locked to. */
export function updateAvailableFor(t: Pick<AllowedToolset, "version" | "latestVersion" | "status">): number | null {
  if (t.version === null || t.latestVersion === null || t.latestVersion === undefined) return null;
  if (t.status === "REMOVED" || t.status === "DELETED") return null;
  return t.latestVersion > t.version ? t.latestVersion : null;
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

/* ------------------------------------------------------------------ the draft */

/**
 * What this agent can use, as the editor holds it before Save: one form, one
 * Save and one Cancel, so a mis-click changes nothing until it is saved, and
 * "limit to 2 tools and exclude 1 provider" is five clicks (Only these, two
 * ticks, one provider tick, Save).
 */
export interface AccessDraft {
  mode: "ALL" | "RESTRICTED";
  /** `version`: the lock, kept as it was (another organization's tool set must stay locked). */
  toolsets: { toolsetId: string; viaUrlOnly: boolean; version?: number | null }[];
  toolIds: string[];
  exclude: string[];
  /** Atomic units in the policy's asset; null = no max price. */
  maxPrice: string | null;
  verified: boolean;
}

export function draftFrom(access: AgentAccess): AccessDraft {
  return {
    mode: access.accessMode,
    toolsets: access.allowedToolsets.map((t) => ({ toolsetId: t.toolsetId, viaUrlOnly: t.viaUrlOnly, version: t.version ?? null })),
    toolIds: [...access.allowedToolIds],
    exclude: [...access.rules.excludeProviderIds],
    maxPrice: access.rules.maxPrice?.amount ?? null,
    verified: access.rules.minTier !== null,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const toolsetKey = (t: { toolsetId: string; viaUrlOnly: boolean; version?: number | null }) => `${t.toolsetId}:${t.viaUrlOnly}:${t.version ?? "latest"}`;

/** The PATCH body for the fields the draft changed, or null when nothing changed. */
export function draftBody(access: AgentAccess, draft: AccessDraft): UpdateAgentAccessBody | null {
  const before = draftFrom(access);
  const body: UpdateAgentAccessBody = {};
  if (draft.mode !== before.mode) body.accessMode = draft.mode;
  if (!sameSet(draft.toolsets.map(toolsetKey), before.toolsets.map(toolsetKey))) {
    body.allowedToolsets = draft.toolsets.map((t) => ({ toolsetId: t.toolsetId, version: t.version ?? null, viaUrlOnly: t.viaUrlOnly }));
  }
  if (!sameSet(draft.toolIds, before.toolIds)) body.allowedToolIds = [...draft.toolIds];
  const rules: NonNullable<UpdateAgentAccessBody["rules"]> = {};
  if (!sameSet(draft.exclude, before.exclude)) rules.excludeProviderIds = [...draft.exclude];
  if (draft.maxPrice !== before.maxPrice) rules.maxPrice = draft.maxPrice;
  if (draft.verified !== before.verified) rules.minTier = draft.verified ? (access.rules.minTier ?? "ESTABLISHED") : null;
  if (Object.keys(rules).length > 0) body.rules = rules;
  if (Object.keys(body).length === 0) return null;
  return { ...body, changeReason: "Changed what this agent can use" };
}

/** Everything as it was — what Undo sends after a save. */
export function restoreBody(access: AgentAccess): UpdateAgentAccessBody {
  return {
    accessMode: access.accessMode,
    // Another organization's deleted tool set still allows its pinned version, so it is kept.
    allowedToolsets: access.allowedToolsets
      .filter((t) => !t.deleted || t.own === false)
      .map((t) => ({ toolsetId: t.toolsetId, version: t.version ?? null, viaUrlOnly: t.viaUrlOnly })),
    allowedToolIds: [...access.allowedToolIds],
    rules: {
      excludeProviderIds: [...access.rules.excludeProviderIds],
      maxPrice: access.rules.maxPrice?.amount ?? null,
      minTier: access.rules.minTier,
    },
    changeReason: "Undid a change to what this agent can use",
  };
}

/** The draft's changes in words, for the save bar: ["Only these: 2 tools", "1 provider excluded"]. */
export function draftChanges(access: AgentAccess, draft: AccessDraft): string[] {
  const body = draftBody(access, draft);
  if (!body) return [];
  const out: string[] = [];
  if (body.accessMode === "ALL") out.push("Everything");
  if (body.accessMode === "RESTRICTED" || (draft.mode === "RESTRICTED" && (body.allowedToolIds || body.allowedToolsets))) {
    const sets = draft.toolsets.length;
    const tools = draft.toolIds.length;
    out.push(
      sets + tools === 0
        ? "Only these: nothing yet"
        : `Only these: ${[sets ? `${sets} tool set${sets === 1 ? "" : "s"}` : null, tools ? `${tools} tool${tools === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ")}`,
    );
  }
  if (body.rules?.excludeProviderIds) out.push(`${draft.exclude.length} provider${draft.exclude.length === 1 ? "" : "s"} excluded`);
  if (body.rules && "maxPrice" in body.rules) out.push(draft.maxPrice === null ? "no max price" : "new max price");
  if (body.rules && "minTier" in body.rules) out.push(draft.verified ? "only verified providers" : "any provider tier");
  return out;
}
