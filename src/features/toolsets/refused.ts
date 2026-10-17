import type { RefusedCall, RefusedProvider } from "@/services/toolsets.service";

import { REFUSAL_LAYER_LABELS, refusalText } from "./labels";

/**
 * A refused call as a person reads it (design spec §7.10, sketch B): not
 * charged, the plain reason, the layer that refused it, each provider with its
 * reason, and the one-click fix. Pure; the screen only lays it out.
 */

export type RefusalFix =
  | { kind: "include-provider"; providerId: string; label: string }
  | { kind: "clear-max-price"; label: string }
  | { kind: "allow-any-tier"; label: string }
  | { kind: "allow-tool"; toolId: string; label: string }
  | { kind: "edit-toolset"; toolsetId: string; label: string }
  | { kind: "link"; href: string; label: string };

export interface RefusedProviderView {
  providerId: string;
  reason: string;
  /** "This agent's provider limits" or "The tool set's rules". */
  source: string;
  fix: RefusalFix | null;
}

export interface RefusedCallView {
  title: string;
  reason: string;
  layer: string;
  providers: RefusedProviderView[];
  /** "This tool has one provider, so nothing else can run it." — when it applies. */
  singleProviderNote: string | null;
  /** The fix for the whole call (allow the tool, change the spending limits), when it is not per provider. */
  fix: RefusalFix | null;
}

const fromAgent = (p: RefusedProvider) => p.source === "AGENT";

function differentAsset(p: RefusedProvider): boolean {
  return /different asset/i.test(p.detail ?? "");
}

/** One provider's reason, in words. `detail` (the backend's own short sentence) refines a price. */
export function providerReason(p: RefusedProvider): string {
  const whose = fromAgent(p) ? "this agent's" : "the tool set's";
  switch (p.reason) {
    case "EXCLUDED_BY_AGENT":
      return "Blocked by this agent's provider limits";
    case "EXCLUDED_BY_TOOLSET":
      return "Left out by the tool set's rules (All except)";
    case "NOT_IN_ALLOWED_PROVIDERS":
      return "Not one of the tool set's chosen providers (Only these)";
    case "BELOW_MIN_TIER":
      return `Not verified, and ${whose} limits allow only verified providers`;
    case "ABOVE_MAX_PRICE":
      return differentAsset(p)
        ? `Priced in a different currency than ${whose} max price, so it cannot be compared`
        : `Costs more than ${whose} max price`;
    case "BELOW_MIN_QUALITY":
      return `Below ${whose} minimum quality`;
    case "PAYEE_NO_LONGER_ELIGIBLE":
      return "The provider offered for payment no longer fits your limits; the agent can retry for a new offer";
    default:
      return p.detail || "Did not fit the rules";
  }
}

function providerFix(call: RefusedCall, p: RefusedProvider): RefusalFix | null {
  if (!fromAgent(p)) {
    return call.toolsetId ? { kind: "edit-toolset", toolsetId: call.toolsetId, label: "Change the tool set's rules" } : null;
  }
  switch (p.reason) {
    case "EXCLUDED_BY_AGENT":
      return { kind: "include-provider", providerId: p.providerId, label: "Remove from limits" };
    case "ABOVE_MAX_PRICE":
      return { kind: "clear-max-price", label: "Remove the max price" };
    case "BELOW_MIN_TIER":
      return { kind: "allow-any-tier", label: "Allow unverified providers" };
    default:
      return { kind: "link", href: `/agents?agent=${encodeURIComponent(call.agentId)}#access`, label: "Open provider limits" };
  }
}

function callFix(call: RefusedCall): RefusalFix | null {
  switch (call.refusalCode) {
    case "TOOL_NOT_ALLOWED":
      return call.toolId ? { kind: "allow-tool", toolId: call.toolId, label: "Allow this tool" } : null;
    case "TOOL_NOT_IN_TOOLSET":
      return call.toolsetId
        ? { kind: "edit-toolset", toolsetId: call.toolsetId, label: "Add it to the tool set" }
        : { kind: "link", href: "/connect", label: "Connect a server that has it" };
    case "MCP_SPEND_LIMIT_EXCEEDED":
    case "MCP_VELOCITY_LIMIT_EXCEEDED":
    case "MCP_POLICY_AGENT_PAUSED":
      return { kind: "link", href: "/limits", label: "Open spending limits" };
    default:
      return null;
  }
}

export function refusedCallView(call: RefusedCall): RefusedCallView {
  // One button per fix: a max price that cut three providers is removed once.
  const seen = new Set<string>();
  const providers = call.providers.map((p) => {
    const fix = providerFix(call, p);
    const key = fix ? (fix.kind === "include-provider" ? `${fix.kind}:${fix.providerId}` : fix.kind === "link" ? fix.href : fix.kind) : "";
    const first = Boolean(fix) && !seen.has(key);
    seen.add(key);
    return {
      providerId: p.providerId,
      reason: providerReason(p),
      source: fromAgent(p) ? "This agent's provider limits" : "The tool set's rules",
      fix: first ? fix : null,
    };
  });
  return {
    title: "Call refused · not charged",
    reason: refusalText(call.refusalCode),
    layer: REFUSAL_LAYER_LABELS[call.refusalLayer] ?? "Refused before anything was charged",
    providers,
    singleProviderNote:
      call.refusalCode === "NO_PROVIDER_MATCHES_RULES" && call.providers.length === 1
        ? "This tool has one provider, so nothing else can run it."
        : null,
    fix: callFix(call),
  };
}

/** Where the call came in: "via my/research", "via /", for the row's second line. */
export function viaText(call: Pick<RefusedCall, "endpointKind" | "viewFilter">, toolsetName?: string | null): string {
  if (call.endpointKind === "TOOLSET") return toolsetName ? `via ${toolsetName}` : "via a tool set";
  const tools = Array.isArray(call.viewFilter?.tools) ? (call.viewFilter!.tools as string[]) : null;
  if (tools && tools.length > 0) return "via Only these tools";
  return "via Everything";
}
