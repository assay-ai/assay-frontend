import type { OnEmpty, ProviderMode, RefusalLayer } from "@/services/toolsets.service";

/**
 * The plain labels of design spec §6.3. The wire speaks `BEST`, `ONLY`,
 * `FALLBACK_BEST`, `RESTRICTED`; a person reads these instead, and no screen
 * prints an internal word (discovery, FULL/SEARCH, UNLISTED, FALLBACK_BEST,
 * access policy).
 */

export const PROVIDER_MODE_LABELS: Record<ProviderMode, string> = {
  BEST: "Any (Assay picks)",
  ONLY: "Only these",
  EXCLUDE: "All except",
};

export const ON_EMPTY_LABELS: Record<OnEmpty, string> = {
  FAIL: "Stop the call",
  FALLBACK_BEST: "Let Assay pick the best one",
};

export const REFUSAL_LAYER_LABELS: Record<RefusalLayer, string> = {
  SERVER: "Refused by the server it called",
  AGENT_LIMITS: "Refused by this agent's settings",
  TOOLSET_RULES: "Refused by the tool set's rules",
};

/** The sentence an agent got back, as a person reads it. */
const REFUSAL_TEXT: Record<string, string> = {
  TOOL_NOT_IN_TOOLSET: "Not part of this server.",
  TOOL_NOT_ALLOWED: "This agent isn't allowed to use it.",
  NO_PROVIDER_MATCHES_RULES: "No provider fits your limits.",
  TOOL_REMOVED: "This tool was removed by its maker.",
  CONTRACT_VERSION_RETIRED: "This version of the tool was retired.",
  UNSUPPORTED_INPUT_FIELD: "No allowed provider supports one of the inputs it sent.",
  MCP_SPEND_LIMIT_EXCEEDED: "This call would go over a spending limit.",
  MCP_VELOCITY_LIMIT_EXCEEDED: "Calls came too fast for this agent's rate limit.",
  MCP_QUOTA_EXCEEDED: "Today's free calls are used up, and this server serves free calls only.",
  MCP_POLICY_AGENT_PAUSED: "Paid calls are paused for this agent.",
  MCP_APPROVAL_REQUIRED: "This call needs a person's approval.",
  PAYMENT_PRICE_BELOW_MINIMUM: "Every provider of this tool charges less than the paid-call minimum, so it can't take paid calls right now.",
};

export function refusalText(code: string): string {
  return REFUSAL_TEXT[code] ?? "This call was refused before anything was charged.";
}

export const ACCESS_LABEL = "What this agent can use";
export const PROVIDER_LIMITS_LABEL = "Provider limits";
export const VERIFIED_ONLY_LABEL = "Only verified providers";
export const DRAFT_NOTICE = "Changes reach your agents immediately.";

/* -------------------------------------------------------------- T2 */

/** Who can use a tool set (§6.3). */
export const VISIBILITY_LABELS: Record<"PRIVATE" | "UNLISTED" | "PUBLIC", string> = {
  PRIVATE: "Only my team",
  UNLISTED: "Anyone with the link",
  PUBLIC: "Listed in the catalogue",
};

export const VISIBILITY_DETAILS: Record<"PRIVATE" | "UNLISTED" | "PUBLIC", string> = {
  PRIVATE: "Only your team's agents can connect it.",
  UNLISTED: "Anyone you send the link to can connect it. It is not in the catalogue.",
  PUBLIC: "Anyone can find it in the catalogue and connect it.",
};

export const PUBLIC_NAME_LABEL = "Public name";
export const STOP_SHARING_LABEL = "Stop sharing";
export const MAKE_MY_OWN_LABEL = "Make my own version";
export const MAKE_MY_OWN_HINT = "Change rules. Doesn't get updates.";
export const ALWAYS_LOADED_LABEL = "Always loaded";
export const HOW_AGENT_SEES_LABEL = "How the agent sees tools";

/** "How the agent sees tools" (§6.3): Automatic / Show all / Let the agent search. */
export const DISCOVERY_LABELS: Record<"auto" | "full" | "search", string> = {
  auto: "Automatic",
  full: "Show all tools",
  search: "Let the agent search",
};

export const DISCOVERY_DETAILS: Record<"auto" | "full" | "search", string> = {
  auto: "Shows every tool while there are 25 or fewer; past that the agent searches.",
  full: "Every tool is listed. Simple, but each tool costs tokens on every request.",
  search: "Lists only the always-loaded tools and three search tools; the agent finds the rest when it needs them.",
};

/** A version lock in words: "Lock to v3 (no surprise changes)". */
export function lockLabel(version: number): string {
  return `Lock to v${version} (no surprise changes)`;
}

export const ALWAYS_LATEST_LABEL = "Always latest";

/** Badges on public tool sets. */
export const BADGE_LABELS: Record<string, string> = {
  OFFICIAL: "Official",
  PROVIDER: "Provider",
  COMMUNITY: "Community",
};

/** A setting a version changed, in words (the wire says `discovery`, `pinnedTools`…). */
const SETTING_LABELS: Record<string, string> = {
  discovery: "how the agent sees tools",
  searchThreshold: "when the agent starts searching",
  pinnedTools: "always-loaded tools",
  name: "name",
  description: "description",
  icon: "icon",
};

export function settingLabel(setting: string): string {
  return SETTING_LABELS[setting] ?? setting.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** The notice on a tool set entry whose tool Assay took down (BUG-X-05). */
export const TAKEN_DOWN_LABEL = "Removed by Assay";
export const TAKEN_DOWN_NOTE = "Assay took this tool down, so agents no longer see it. Remove it from the set, or keep it in case it comes back.";

/** The tool ids of a set's entries that Assay took down (`takenDown`; none on an older server). */
export function takenDownToolIds(entries: readonly { toolId: string; takenDown?: boolean }[]): Set<string> {
  return new Set(entries.filter((e) => e.takenDown === true).map((e) => e.toolId));
}

/**
 * "· 2 tools" on the Draft, without the taken-down tools agents no longer see:
 * "· 1 tool · 1 removed by Assay".
 */
export function draftToolCountText(toolCount: number, entries: readonly { toolId: string; takenDown?: boolean }[]): string {
  const removed = takenDownToolIds(entries).size;
  const live = Math.max(0, toolCount - removed);
  const base = `${live} tool${live === 1 ? "" : "s"}`;
  return removed > 0 ? `${base} · ${removed} removed by Assay` : base;
}
