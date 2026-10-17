import type { McpUrlPreview, ServerInUse } from "@/services/toolsets.service";

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

/**
 * Every count the sheet shows, from one place: the tools this URL serves
 * (`inView`), those `tools/list` returns this agent (`listed`), those of them
 * a provider can run now (`usable`), and those access blocks (`blocked`).
 */
export function previewCounts(preview: Pick<McpUrlPreview, "tools" | "listedCount">) {
  return {
    inView: preview.tools.length,
    listed: preview.listedCount,
    usable: preview.tools.filter((t) => t.listed && !t.noProviderFits).length,
    blocked: preview.tools.filter((t) => !t.allowed).length,
  };
}

/**
 * "Your agent will see 4 tools, 3 usable now (~960 tokens). 11 more are
 * blocked for this agent." In search mode: "4 tools (search) — about 0.9k
 * tokens; 37 tools reachable". While the preview loads the caller shows a
 * skeleton or "~"; this is never asked for a number it does not have, so it
 * never says 0 for "not known yet".
 */
export function previewSummary(
  preview: Pick<McpUrlPreview, "tools" | "listedCount" | "estimatedTokens"> & Partial<Pick<McpUrlPreview, "discovery" | "reachableCount">>,
): string {
  if (preview.discovery === "SEARCH") {
    const reachable = preview.reachableCount ?? preview.tools.filter((t) => t.allowed && !t.noProviderFits).length;
    return `${tools(preview.listedCount)} (search) — about ${aboutTokens(preview.estimatedTokens)} tokens; ${tools(reachable)} reachable`;
  }
  const c = previewCounts(preview);
  const blocked = c.blocked > 0 ? ` ${c.blocked} ${c.listed === 0 ? "" : "more "}${c.blocked === 1 ? "is" : "are"} blocked for this agent.` : "";
  if (c.listed === 0) return `Your agent will see no tools here.${blocked}`;
  const usable = c.usable < c.listed ? `, ${c.usable} usable now` : "";
  return `Your agent will see ${tools(c.listed)}${usable} (${tokensText(preview.estimatedTokens)} tokens).${blocked}`;
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
