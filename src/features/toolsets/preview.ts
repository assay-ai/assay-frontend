import type { McpUrlPreview, NoFitReason, PreviewTool, ServerInUse } from "@/services/toolsets.service";

/**
 * The Connect sheet's summary line and warnings (design spec §7.11), from
 * `POST /mcp-urls/preview`. Pure: every state the sheet can be in is a value
 * here, so each is tested without a browser.
 */

/** Past this many tools shown in full across an agent's servers, it is over budget (§7.10). */
export const SHOW_ALL_TOOL_BUDGET = 25;

/** "~2.8k", "~640": an estimate, always with the tilde. */
export function tokensText(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `~${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `~${Math.max(10, Math.round(tokens / 10) * 10)}`;
}

/** "0.9k", "1.2k", "320": the search line's estimate, in thousands from 500 up. */
function aboutTokens(tokens: number): string {
  if (tokens >= 500 && tokens < 10_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return tokensText(tokens).slice(1);
}

function tools(n: number): string {
  return `${n} tool${n === 1 ? "" : "s"}`;
}

/** A paid tool whose providers settle only on chains this agent does not pay on (the call is refused). */
function paidElsewhere(tool: PreviewTool): boolean {
  return !tool.noProviderFits && tool.noFitReason === "OTHER_CHAIN" && tool.pricingMode !== "FREEMIUM";
}

/**
 * Every count the sheet shows, from one place: the tools this URL serves
 * (`inView`), those `tools/list` returns this agent (`listed`), those of them
 * a provider can run now for this agent (`usable`), and those access blocks
 * (`blocked`). A paid tool none of whose providers settles on the agent's
 * chain is listed but not usable.
 */
export function previewCounts(preview: Pick<McpUrlPreview, "tools" | "listedCount">) {
  return {
    inView: preview.tools.length,
    listed: preview.listedCount,
    usable: preview.tools.filter((t) => t.listed && !t.noProviderFits && !paidElsewhere(t)).length,
    blocked: preview.tools.filter((t) => !t.allowed).length,
  };
}

/**
 * Why a tool here cannot run for this agent. `free-only`: a FREEMIUM tool
 * whose providers take no payment on the agent's chain — its free calls run,
 * its paid ones are refused — so it is listed with the others but not counted
 * as unable to run.
 */
export type CantRunReason = "blocked" | NoFitReason | "free-only" | "no-provider";

/** One tool's reason, from the preview's own fields. Null when it can run. */
export function cantRunReason(tool: PreviewTool): CantRunReason | null {
  if (!tool.allowed) return "blocked";
  if (tool.noProviderFits) return tool.noFitReason ?? "RULES";
  if (tool.noFitReason === "OTHER_CHAIN") return tool.pricingMode === "FREEMIUM" ? "free-only" : "OTHER_CHAIN";
  return tool.listed ? null : "no-provider";
}

const REASON_ONE: Record<CantRunReason, string> = {
  blocked: "blocked for this agent",
  RULES: "no provider fits this agent's limits",
  OTHER_CHAIN: "its providers don't take payment on your chain",
  "free-only": "free calls only: its providers don't take payment on your chain",
  "no-provider": "no provider is taking calls for it now",
};

const REASON_MANY: Record<CantRunReason, (n: number) => string> = {
  blocked: (n) => `${n} blocked for this agent`,
  RULES: (n) => `${n} with no provider that fits its limits`,
  OTHER_CHAIN: (n) => `${n} whose providers don't take payment on your chain`,
  "free-only": (n) => `${n} with free calls only on your chain`,
  "no-provider": (n) => `${n} with no provider taking calls`,
};

const REASON_ORDER: readonly CantRunReason[] = ["blocked", "RULES", "OTHER_CHAIN", "no-provider"];

/** The tools here that cannot run (or run free calls only) for this agent, each with its reason in words. */
export function cantRunTools(preview: Pick<McpUrlPreview, "tools">): { toolId: string; name: string; reason: CantRunReason; text: string }[] {
  return preview.tools.flatMap((tool) => {
    const reason = cantRunReason(tool);
    return reason ? [{ toolId: tool.toolId, name: tool.name, reason, text: REASON_ONE[reason] }] : [];
  });
}

/** "2 blocked for this agent, 5 with no provider taking calls": the reasons that stop a tool, counted. */
function reasonCounts(reasons: readonly CantRunReason[]): string {
  return REASON_ORDER.filter((r) => reasons.includes(r))
    .map((r) => REASON_MANY[r](reasons.filter((x) => x === r).length))
    .join(", ");
}

/**
 * The one summary line, with the same counts the warnings use:
 *
 *   all fine     "Your agent will see 3 tools (~690 tokens)."
 *   otherwise    "3 tools here: 1 ready to use, 2 blocked for this agent (~230 tokens)."
 *   search mode  "Your agent can reach 1 of 8 tools (7 can't run: 7 with no provider taking calls) through search: 3 tools listed, about 0.4k tokens."
 *
 * In search mode the tools listed are the search helpers and any pinned ones,
 * not the tools reached, so the two counts are never put side by side bare.
 * While the preview loads the caller shows a skeleton or "~"; this is never
 * asked for a number it does not have, so it never says 0 for "not known yet".
 */
export function previewSummary(
  preview: Pick<McpUrlPreview, "tools" | "listedCount" | "estimatedTokens"> & Partial<Pick<McpUrlPreview, "discovery" | "reachableCount">>,
): string {
  const c = previewCounts(preview);
  if (preview.discovery === "SEARCH") {
    // The tools that actually run: the backend's reachableCount also counts a
    // tool the rules emptied, which is then counted again under "can't run".
    const reachable = c.usable;
    const of = reachable < c.inView ? `${reachable} of ${tools(c.inView)}` : tools(reachable);
    const cant = cantRunTools(preview)
      .map((t) => t.reason)
      .filter((r) => r !== "free-only");
    const why = cant.length > 0 ? ` (${cant.length} can't run: ${reasonCounts(cant)})` : "";
    return `Your agent can reach ${of}${why} through search: ${tools(preview.listedCount)} listed, about ${aboutTokens(preview.estimatedTokens)} tokens.`;
  }
  const blockedText = c.blocked > 0 ? `${c.blocked} blocked for this agent` : null;
  const noFit = c.listed - c.usable;
  if (c.blocked === 0 && noFit === 0) {
    return c.listed === 0 ? "Your agent will see no tools here." : `Your agent will see ${tools(c.listed)} (${tokensText(preview.estimatedTokens)} tokens).`;
  }
  const noFitReasons = preview.tools
    .filter((t) => t.listed && (t.noProviderFits || paidElsewhere(t)))
    .map((t) => cantRunReason(t) ?? "RULES");
  const parts = [
    c.usable > 0 ? `${c.usable} ready to use` : "none ready to use",
    blockedText,
    noFitReasons.length > 0 ? reasonCounts(noFitReasons) : null,
  ].filter(Boolean);
  const cost = c.listed > 0 ? ` (${tokensText(preview.estimatedTokens)} tokens)` : "";
  return `${tools(c.inView)} here: ${parts.join(", ")}${cost}.`;
}

export type PreviewFix =
  | { kind: "allow-tools"; toolIds: string[]; toolNames: string[] }
  | { kind: "open-access" };

export interface PreviewWarning {
  code: string;
  tone: "warning" | "danger" | "info";
  text: string;
  fix?: PreviewFix;
}

function names(list: readonly string[], max = 3): string {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

/**
 * The warnings in the order a person should act on them — blocked tools
 * first, then tools no provider can run, then the softer notes — and one line
 * per tool: a tool no provider fits is not also listed as having no backup.
 */
export function previewWarnings(preview: McpUrlPreview): PreviewWarning[] {
  const of = (code: string) => preview.warnings.find((w) => w.code === code)?.tools ?? [];
  const blockedTools = of("BLOCKED_BY_ACCESS");
  const blockedIds = blockedTools.map((t) => t.toolId).filter((id): id is string => Boolean(id));
  const fallbackBlocked = preview.tools.filter((t) => !t.allowed);
  const allowFix: PreviewFix =
    blockedIds.length > 0
      ? { kind: "allow-tools", toolIds: blockedIds, toolNames: blockedTools.map((t) => t.name) }
      : { kind: "allow-tools", toolIds: fallbackBlocked.map((t) => t.toolId), toolNames: fallbackBlocked.map((t) => t.name) };
  const out: PreviewWarning[] = [];
  const nothing = preview.warnings.some((w) => w.code === "NOTHING_ALLOWED");
  if (nothing) {
    out.push({
      code: "NOTHING_ALLOWED",
      tone: "danger",
      text: "This agent can't use any tool on this server, so there is nothing to copy yet.",
      fix: allowFix.toolIds.length > 0 ? allowFix : { kind: "open-access" },
    });
  } else if (blockedTools.length > 0) {
    const n = blockedTools.length;
    out.push({
      code: "BLOCKED_BY_ACCESS",
      tone: "warning",
      text:
        n === 1
          ? `${blockedTools[0]!.name} is blocked for this agent.`
          : `${n} of these tools are blocked for this agent: ${names(blockedTools.map((t) => t.name))}.`,
      fix: allowFix,
    });
  }
  const noFit = of("NO_PROVIDER_FITS").map((t) => t.name);
  if (noFit.length > 0) {
    out.push({
      code: "NO_PROVIDER_FITS",
      tone: "warning",
      text: `No provider fits this agent's provider limits for ${names(noFit)}, so ${noFit.length === 1 ? "it" : "they"} can't run now.`,
      fix: { kind: "open-access" },
    });
  }
  // Read from the tools (the backend sends no warning for it): a paid tool
  // whose providers settle only on chains this agent does not pay on. Not the
  // agent's limits, so no "open access" fix (review 2026-10-18 F-P1).
  const elsewhere = preview.tools.filter((t) => t.allowed && paidElsewhere(t)).map((t) => t.name);
  if (elsewhere.length > 0) {
    out.push({
      code: "OTHER_CHAIN",
      tone: "warning",
      text: `The providers of ${names(elsewhere)} don't take payment on your chain, so paid calls from this agent are refused.`,
    });
  }
  const single = of("NO_BACKUP_PROVIDER")
    .map((t) => t.name)
    .filter((name) => !noFit.includes(name));
  if (single.length > 0) {
    out.push({
      code: "NO_BACKUP_PROVIDER",
      tone: "info",
      text:
        single.length === 1
          ? `Only one provider offers ${single[0]}: if it is down, the call fails.`
          : `Only one provider offers each of ${names(single)}: if one is down, that call fails.`,
    });
  }
  const ignored = of("IGNORED_TOOLS").map((t) => t.name);
  if (ignored.length > 0) out.push({ code: "IGNORED_TOOLS", tone: "info", text: `Not found, so left out: ${names(ignored)}.` });
  return out;
}

/** Copy is off only when access leaves zero tools (§7.11); a failed preview never blocks it. */
export function copyBlocked(preview: McpUrlPreview | null | undefined): boolean {
  return Boolean(preview?.warnings.some((w) => w.code === "NOTHING_ALLOWED"));
}

/**
 * Over budget with this server added: the tools shown in full by this server
 * and by the agent's OTHER servers that show every tool (the same URL is not
 * counted twice; a server that lets the agent search costs ~4 tools whatever
 * it reaches, so it never counts). Null when it fits, else the total.
 */
export function overBudgetWith(preview: McpUrlPreview, servers: readonly ServerInUse[]): number | null {
  const others = servers
    .filter((s) => s.canonicalUrl !== preview.canonicalUrl && s.available && s.discovery !== "SEARCH")
    .reduce((sum, s) => sum + (s.toolCount ?? 0), 0);
  if (preview.discovery === "SEARCH") return null;
  const total = others + preview.listedCount;
  return total > SHOW_ALL_TOOL_BUDGET ? total : null;
}

/** Whether "Only free tools" is worth offering: something here can be free. */
export function offersFreeOnly(preview: McpUrlPreview | null | undefined): boolean {
  return Boolean(preview?.tools.some((t) => t.pricingMode === "FREE" || t.pricingMode === "FREEMIUM"));
}
