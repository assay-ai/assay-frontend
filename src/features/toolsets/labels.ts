import type { OnEmpty, ProviderMode, RefusalLayer } from "@/services/toolsets.service";

/**
 * The plain labels of design spec §6.3. The wire speaks `BEST`, `ONLY`,
 * `FALLBACK_BEST`, `RESTRICTED`; a person reads these instead, and no screen
 * prints an internal word (discovery, FULL/SEARCH, UNLISTED, FALLBACK_BEST,
 * access policy).
 */

export const TOOL_SET = "Tool set";

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
  SERVER: "Refused by the server it called (the connection)",
  AGENT_LIMITS: "Refused by this agent's limits",
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
};

export function refusalText(code: string): string {
  return REFUSAL_TEXT[code] ?? "This call was refused before anything was charged.";
}

export const ACCESS_LABEL = "What this agent can use";
export const PROVIDER_LIMITS_LABEL = "Provider limits";
export const VERIFIED_ONLY_LABEL = "Only verified providers";
export const DRAFT_NOTICE = "Changes reach your agents immediately.";
