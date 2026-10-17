import { bindingMajors, formatVersionRange, majorOf, majorsText, parseSemver, parseVersionRange } from "@/features/contracts/semver";
import { fieldList, mustReturnLabel, newerVersion } from "@/features/contracts/text";
import type { ToolVersionBrief } from "@/interfaces/contracts";
import { routes } from "@/libs/routes";
import type { RefusedCall, RefusedProvider, ToolsetEntry, ToolsetEntryInput } from "@/services/toolsets.service";

import { entryInput } from "./entry-rules";
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
  | { kind: "add-to-toolset"; toolsetId: string; toolId: string; label: string }
  | { kind: "link"; href: string; label: string }
  /* T3: changes to one tool set entry's contract terms. */
  | { kind: "drop-required-field"; toolsetId: string; toolId: string; fields: string[]; label: string }
  /** Widen the entry's range to `majors`; `callMajor` is what the entry used when it had no range. */
  | { kind: "allow-major"; toolsetId: string; toolId: string; majors: number[]; callMajor: number | null; label: string }
  /** Move the entry off retired majors onto `to`. */
  | { kind: "move-major"; toolsetId: string; toolId: string; from: number[]; to: number; label: string };

/** The fixes that rewrite one tool set entry (they share one save and one undo). */
export type EntryFix = Extract<RefusalFix, { kind: "drop-required-field" | "allow-major" | "move-major" }>;

export function isEntryFix(fix: RefusalFix | null): fix is EntryFix {
  return fix !== null && (fix.kind === "drop-required-field" || fix.kind === "allow-major" || fix.kind === "move-major");
}

export interface RefusedProviderView {
  providerId: string;
  /** The provider's name from the call itself; null when unknown (the screen falls back to the id). */
  name: string | null;
  reason: string;
  /** "This agent's provider limits" or "The tool set's rules". */
  source: string;
  fix: RefusalFix | null;
  /** How many of the listed providers this row's fix brings back (one button per fix). */
  fixCovers: number;
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
  /** T3: what the agent can do itself when no setting can fix it (an input nobody accepts, a retired version). */
  note: string | null;
}

/** What the card knows besides the call: the tool's published versions (for a retired one's replacement). */
export interface RefusedCallContext {
  versions?: readonly Pick<ToolVersionBrief, "semver" | "major" | "status">[];
}

const fromAgent = (p: RefusedProvider) => p.source === "AGENT";

function differentAsset(p: RefusedProvider): boolean {
  return /different asset/i.test(p.detail ?? "");
}

/** One provider's reason, in words. `detail` (the backend's own short sentence) refines a price. */
export function providerReason(p: RefusedProvider): string {
  const whose = fromAgent(p) ? "this agent's" : "the tool set's";
  const fields = fieldList(p.fields ?? []);
  switch (p.reason) {
    case "MISSING_OUTPUT_FIELD":
      return fields ? `Doesn't return ${fields}, and the tool set requires it` : "Doesn't return a field the tool set requires";
    case "UNSUPPORTED_INPUT_FIELD":
      return fields ? `Doesn't accept the input ${fields} this call sent` : "Doesn't accept an input this call sent";
    case "CONTRACT_VERSION_MISMATCH": {
      const m = mismatchOf(p);
      if (m.serves.length > 0 && m.callMajor !== null) return `Serves only ${majorsText(m.serves)}; this call uses v${m.callMajor}`;
      return "Doesn't serve the version of the tool this call uses";
    }
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

/**
 * What a CONTRACT_VERSION_MISMATCH provider serves and what the call used,
 * read from the router's own sentence: "binding b-1 serves ^1, not contract
 * v2.0.0". [contract gap] the refused provider has no structured fields for
 * either; when the sentence changes, the reason falls back to a plain one.
 */
export function mismatchOf(p: Pick<RefusedProvider, "detail">): { serves: number[]; callMajor: number | null } {
  const match = /serves (.+?), not contract v(\d+\.\d+\.\d+)/.exec(p.detail ?? "");
  if (!match) return { serves: [], callMajor: null };
  return { serves: parseVersionRange(match[1]) ?? [], callMajor: majorOf(match[2]) };
}

/** Whose rule dropped a provider, in words. */
export function sourceText(source: RefusedProvider["source"]): string {
  switch (source) {
    case "AGENT":
      return "This agent's provider limits";
    case "REQUEST":
      return "The call's own inputs";
    case "MIGRATION":
      return "Contract version";
    default:
      return "The tool set's rules";
  }
}

/** The T3 reasons: never fixed by "Change the tool set's rules" or the agent's limits. */
function contractFix(call: RefusedCall, p: RefusedProvider): RefusalFix | null | undefined {
  const entry = call.toolsetId && call.toolId && call.endpointKind === "TOOLSET" && call.toolsetVersion === null ? { toolsetId: call.toolsetId, toolId: call.toolId } : null;
  switch (p.reason) {
    case "MISSING_OUTPUT_FIELD": {
      const fields = p.fields ?? [];
      if (!entry || fields.length === 0) return entry ? { kind: "edit-toolset", toolsetId: entry.toolsetId, label: "Change the tool set's rules" } : null;
      return { kind: "drop-required-field", ...entry, fields: [...fields].sort(), label: `Remove '${mustReturnLabel(fields)}'` };
    }
    case "CONTRACT_VERSION_MISMATCH": {
      const m = mismatchOf(p);
      if (!entry || m.serves.length === 0) return null;
      return { kind: "allow-major", ...entry, majors: m.serves, callMajor: m.callMajor, label: `Allow ${majorsText(m.serves)}` };
    }
    case "UNSUPPORTED_INPUT_FIELD":
      return null;
    default:
      return undefined;
  }
}

function providerFix(call: RefusedCall, p: RefusedProvider): RefusalFix | null {
  const contract = contractFix(call, p);
  if (contract !== undefined) return contract;
  if (p.source === "REQUEST" || p.source === "MIGRATION") return null;
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

/** The version a retired call should move to, as "v2.0.0", and its major; null when there is none. */
export function replacementOf(context: RefusedCallContext): { label: string; major: number } | null {
  const versions = context.versions ?? [];
  const retired = retiredMajors(context);
  if (retired.length === 0) return null;
  const label = newerVersion(versions, Math.max(...retired));
  const major = parseSemver(label?.slice(1))?.major;
  return label && major !== undefined ? { label, major } : null;
}

/**
 * The majors the call could have used: the RETIRED ones. A catalogue read
 * just before the retirement job ran still says DEPRECATED, so then every
 * major below the newest active one counts.
 */
function retiredMajors(context: RefusedCallContext): number[] {
  const versions = context.versions ?? [];
  const retired = versions.filter((v) => v.status === "RETIRED").map((v) => v.major);
  if (retired.length > 0) return [...new Set(retired)];
  const active = versions.filter((v) => v.status === "ACTIVE").map((v) => v.major);
  if (active.length === 0) return [];
  const newest = Math.max(...active);
  return [...new Set(versions.filter((v) => v.major < newest).map((v) => v.major))];
}

function callFix(call: RefusedCall, context: RefusedCallContext): RefusalFix | null {
  switch (call.refusalCode) {
    case "CONTRACT_VERSION_RETIRED": {
      const next = replacementOf(context);
      if (next && call.toolsetId && call.toolId && call.endpointKind === "TOOLSET" && call.toolsetVersion === null) {
        return { kind: "move-major", toolsetId: call.toolsetId, toolId: call.toolId, from: retiredMajors(context), to: next.major, label: `Use ${next.label}` };
      }
      // A locked tool set version or a pinned URL: the agent needs a new URL.
      if (next) return { kind: "link", href: "/connect", label: `Get a URL for ${next.label}` };
      return { kind: "link", href: "/explore", label: "Find a replacement tool" };
    }
    case "UNSUPPORTED_INPUT_FIELD":
      return call.toolId ? { kind: "link", href: routes.exploreTool(call.toolId), label: "See the inputs it accepts" } : null;
    case "TOOL_NOT_ALLOWED":
      return call.toolId ? { kind: "allow-tool", toolId: call.toolId, label: "Allow this tool" } : null;
    case "TOOL_NOT_IN_TOOLSET":
      return call.toolsetId && call.toolId
        ? { kind: "add-to-toolset", toolsetId: call.toolsetId, toolId: call.toolId, label: "Add it to the tool set" }
        : { kind: "link", href: "/connect", label: "Connect a server that has it" };
    case "MCP_SPEND_LIMIT_EXCEEDED":
    case "MCP_VELOCITY_LIMIT_EXCEEDED":
    case "MCP_POLICY_AGENT_PAUSED":
      return { kind: "link", href: "/limits", label: "Open spending limits" };
    default:
      return null;
  }
}

/**
 * Who refused it, in words that are not confused with spending limits: the
 * agent's tool list (which tools it may call), its provider limits, the tool
 * set's rules — or both of the last two, when each dropped a provider.
 */
export function refusalLayerText(call: Pick<RefusedCall, "refusalCode" | "refusalLayer" | "providers" | "toolsetId">): string {
  switch (call.refusalCode) {
    case "TOOL_NOT_ALLOWED":
      return "Refused by this agent's tool list: it is not one of the tools this agent may use";
    case "TOOL_NOT_IN_TOOLSET":
      return call.toolsetId
        ? "Refused by the server it called: that server serves only what its tool set lists"
        : "Refused by the server it called: the tool is not on that server";
    case "NO_PROVIDER_MATCHES_RULES": {
      const agent = call.providers.some(fromAgent);
      const toolset = call.providers.some((p) => p.source === "TOOLSET");
      if (agent && toolset) return "Refused by both this agent's provider limits and the tool set's rules";
      if (toolset) return "Refused by the tool set's rules";
      if (agent) return "Refused by this agent's provider limits";
      if (call.providers.some((p) => p.source === "REQUEST")) return "Refused because of the inputs the call sent";
      if (call.providers.length > 0) return "Refused because no provider serves the version of the tool this call uses";
      return "Refused by this agent's provider limits";
    }
    case "UNSUPPORTED_INPUT_FIELD":
      return "Refused because of the inputs the call sent: Assay never drops an input silently";
    case "CONTRACT_VERSION_RETIRED":
      return "Refused by the server it called: the version of the tool it uses was retired";
    case "MCP_SPEND_LIMIT_EXCEEDED":
    case "MCP_VELOCITY_LIMIT_EXCEEDED":
    case "MCP_POLICY_AGENT_PAUSED":
      return "Refused by this agent's spending limits";
    default:
      return REFUSAL_LAYER_LABELS[call.refusalLayer] ?? "Refused before anything was charged";
  }
}

function fixKey(fix: RefusalFix): string {
  if (fix.kind === "include-provider") return `${fix.kind}:${fix.providerId}`;
  if (fix.kind === "drop-required-field") return `${fix.kind}:${fix.fields.join(",")}`;
  if (fix.kind === "allow-major") return `${fix.kind}:${fix.majors.join(",")}`;
  if (fix.kind === "link") return fix.href;
  return fix.kind;
}

/** Every field the providers name for one reason, sorted and once. */
function fieldsFor(call: RefusedCall, reason: string): string[] {
  return [...new Set(call.providers.filter((p) => p.reason === reason).flatMap((p) => p.fields ?? []))].sort();
}

/** The plain reason; T3 refusals say which field or version, not only "No provider fits". */
function reasonOf(call: RefusedCall, context: RefusedCallContext): string {
  const all = (reason: string) => call.providers.length > 0 && call.providers.every((p) => p.reason === reason);
  if (call.refusalCode === "UNSUPPORTED_INPUT_FIELD") {
    const fields = fieldsFor(call, "UNSUPPORTED_INPUT_FIELD");
    return fields.length > 0 ? `No allowed provider supports ${fieldList(fields)}.` : refusalText(call.refusalCode);
  }
  if (call.refusalCode === "CONTRACT_VERSION_RETIRED") {
    const next = replacementOf(context);
    return next ? `This version of the tool was retired. Use ${next.label}.` : refusalText(call.refusalCode);
  }
  if (call.refusalCode === "NO_PROVIDER_MATCHES_RULES") {
    const missing = fieldList(fieldsFor(call, "MISSING_OUTPUT_FIELD"));
    if (all("MISSING_OUTPUT_FIELD")) return `No provider returns ${missing}, which the tool set requires.`;
    if (missing && !call.providers.some(fromAgent)) return `No provider fits the tool set's rules. Some don't return ${missing}, which it requires.`;
    if (all("CONTRACT_VERSION_MISMATCH")) return "No provider serves this version of the tool yet.";
  }
  return refusalText(call.refusalCode);
}

function noteOf(call: RefusedCall, context: RefusedCallContext): string | null {
  if (call.refusalCode === "UNSUPPORTED_INPUT_FIELD") {
    const fields = fieldList(fieldsFor(call, "UNSUPPORTED_INPUT_FIELD")) || "an optional input";
    return `Your agent sent ${fields}, and no provider it may use accepts it, so the call was refused rather than run without it. Call without ${fields}, or allow a provider that accepts it.`;
  }
  if (call.refusalCode === "CONTRACT_VERSION_RETIRED" && !replacementOf(context)) {
    return "No newer version of this tool serves yet. Pick another tool that does the same job.";
  }
  return null;
}

/**
 * The entry a T3 fix leaves, as `PUT …/entries` takes it. Pure.
 *
 *   drop-required-field  "Must return" without the fields
 *   allow-major          the range widened (an entry with no range used `callMajor`)
 *   move-major           the retired majors replaced by `to`
 */
export function entryAfterFix(entry: ToolsetEntry | ToolsetEntryInput, fix: EntryFix): ToolsetEntryInput {
  const base = entryInput(entry);
  const current = parseVersionRange(entry.toolVersionRange ?? null);
  switch (fix.kind) {
    case "drop-required-field":
      return { ...base, requireOutputFields: (entry.requireOutputFields ?? []).filter((f) => !fix.fields.includes(f)) };
    case "allow-major": {
      const from = current ?? (fix.callMajor !== null ? [fix.callMajor] : []);
      return { ...base, toolVersionRange: formatVersionRange([...from, ...fix.majors]) };
    }
    case "move-major": {
      const kept = (current ?? []).filter((m) => !fix.from.includes(m));
      return { ...base, toolVersionRange: formatVersionRange([...kept, fix.to]) };
    }
  }
}

/** Whether the entry already reads as the fix would leave it (the fix was applied elsewhere). */
export function entryAlreadyFixed(entry: ToolsetEntry | ToolsetEntryInput, fix: EntryFix): boolean {
  if (fix.kind === "drop-required-field") return !(entry.requireOutputFields ?? []).some((f) => fix.fields.includes(f));
  const majors = bindingMajors(entry.toolVersionRange ?? null);
  if (fix.kind === "allow-major") return entry.toolVersionRange != null && fix.majors.every((m) => majors.includes(m));
  return entry.toolVersionRange != null && majors.includes(fix.to) && !fix.from.some((m) => majors.includes(m));
}

export function refusedCallView(call: RefusedCall, context: RefusedCallContext = {}): RefusedCallView {
  // One button per fix: a max price that cut three providers is removed once,
  // on the first of them, saying how many it brings back.
  const fixes = call.providers.map((p) => providerFix(call, p));
  const counts = new Map<string, number>();
  for (const fix of fixes) if (fix) counts.set(fixKey(fix), (counts.get(fixKey(fix)) ?? 0) + 1);
  const seen = new Set<string>();
  const providers = call.providers.map((p, i) => {
    const fix = fixes[i] ?? null;
    const key = fix ? fixKey(fix) : "";
    const first = Boolean(fix) && !seen.has(key);
    seen.add(key);
    return {
      providerId: p.providerId,
      name: p.providerName ?? null,
      reason: providerReason(p),
      source: sourceText(p.source),
      fix: first ? fix : null,
      fixCovers: first ? (counts.get(key) ?? 1) : 0,
    };
  });
  return {
    title: "Call refused · not charged",
    reason: reasonOf(call, context),
    layer: refusalLayerText(call),
    providers,
    singleProviderNote:
      call.refusalCode === "NO_PROVIDER_MATCHES_RULES" && call.providers.length === 1
        ? "This tool has one provider, so nothing else can run it."
        : null,
    fix: callFix(call, context),
    note: noteOf(call, context),
  };
}

/** Where the call came in: "via my/research", "via /", for the row's second line. */
export function viaText(call: Pick<RefusedCall, "endpointKind" | "viewFilter">, toolsetName?: string | null): string {
  if (call.endpointKind === "TOOLSET") return toolsetName ? `via ${toolsetName}` : "via a tool set";
  const tools = Array.isArray(call.viewFilter?.tools) ? (call.viewFilter!.tools as string[]) : null;
  if (tools && tools.length > 0) return "via Only these tools";
  return "via Everything";
}
