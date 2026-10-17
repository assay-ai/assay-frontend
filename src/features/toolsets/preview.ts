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

function tools(n: number): string {
  return `${n} tool${n === 1 ? "" : "s"}`;
}

/**
 * "Your agent will see 12 tools (~2.8k tokens)". While the preview loads the
 * caller shows a skeleton or "~"; this is never asked for a number it does not
 * have, so it never says 0 for "not known yet".
 */
export function previewSummary(preview: Pick<McpUrlPreview, "listedCount" | "estimatedTokens">): string {
  if (preview.listedCount === 0) return "Your agent will see no tools here.";
  return `Your agent will see ${tools(preview.listedCount)} (${tokensText(preview.estimatedTokens)} tokens)`;
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

/** The warnings in the order a person should read them, each with its fix when there is one. */
export function previewWarnings(preview: McpUrlPreview): PreviewWarning[] {
  const blocked = preview.tools.filter((t) => !t.allowed);
  const allowFix: PreviewFix = { kind: "allow-tools", toolIds: blocked.map((t) => t.toolId), toolNames: blocked.map((t) => t.name) };
  const out: PreviewWarning[] = [];
  const nothing = preview.warnings.some((w) => w.code === "NOTHING_ALLOWED");
  if (nothing) {
    out.push({
      code: "NOTHING_ALLOWED",
      tone: "danger",
      text: "This agent can't use any tool on this server, so there is nothing to copy yet.",
      fix: blocked.length > 0 ? allowFix : { kind: "open-access" },
    });
  }
  for (const warning of preview.warnings) {
    const n = warning.tools.length;
    switch (warning.code) {
      case "BLOCKED_BY_ACCESS":
        if (!nothing) {
          out.push({
            code: warning.code,
            tone: "warning",
            text:
              n === 1
                ? `${warning.tools[0]} is blocked for this agent.`
                : `${n} of these tools are blocked for this agent: ${names(warning.tools)}.`,
            fix: allowFix,
          });
        }
        break;
      case "NO_BACKUP_PROVIDER":
        out.push({
          code: warning.code,
          tone: "info",
          text:
            n === 1
              ? `${warning.tools[0]} has no backup provider: if its one provider is down, the call fails.`
              : `${n} tools have no backup provider: ${names(warning.tools)}.`,
        });
        break;
      case "NO_PROVIDER_FITS":
        out.push({
          code: warning.code,
          tone: "warning",
          text: `No provider fits this agent's provider limits for ${names(warning.tools)}.`,
          fix: { kind: "open-access" },
        });
        break;
      case "IGNORED_TOOLS":
        out.push({ code: warning.code, tone: "info", text: `Not found, so left out: ${names(warning.tools)}.` });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Copy is off only when access leaves zero tools (§7.11); a failed preview never blocks it. */
export function copyBlocked(preview: McpUrlPreview | null | undefined): boolean {
  return Boolean(preview?.warnings.some((w) => w.code === "NOTHING_ALLOWED"));
}

/**
 * Over budget with this server added: the tools it shows plus those of the
 * agent's OTHER servers (the same URL is not counted twice). Null when it
 * fits, else the total.
 */
export function overBudgetWith(preview: McpUrlPreview, servers: readonly ServerInUse[]): number | null {
  const others = servers
    .filter((s) => s.canonicalUrl !== preview.canonicalUrl && s.available)
    .reduce((sum, s) => sum + (s.toolCount ?? 0), 0);
  const total = others + preview.listedCount;
  return total > SHOW_ALL_TOOL_BUDGET ? total : null;
}

/** Whether "Only free tools" is worth offering: something here can be free. */
export function offersFreeOnly(preview: McpUrlPreview | null | undefined): boolean {
  return Boolean(preview?.tools.some((t) => t.pricingMode === "FREE" || t.pricingMode === "FREEMIUM"));
}
