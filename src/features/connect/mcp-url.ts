import { mcpHost } from "./mcp-endpoint";

/**
 * MCP server URLs as the Connect sheet builds and reads them (design spec
 * §7.4, §7.11). The sheet asks one question, "What should it use?", and each
 * answer is one URL on the MCP host:
 *
 * ```text
 * Everything                 /
 * One of my tool sets        /my/{slug}
 * Only these tools           /?tools=a,b,c
 * + "Only free tools"        …free=1
 * ```
 *
 * The URL is written in the backend's canonical form (tools deduplicated and
 * sorted, parameters in a fixed order, commas unescaped), so the URL a person
 * copies is the same string the server attributes calls to and lists under
 * Servers in use.
 *
 * Any other URL of the host (a shared tool set, a topic, a maker: later
 * phases) is kept as it is — `{ kind: "url" }` — so a Connect panel opened
 * from such a page still hands out exactly that URL.
 */
export type ConnectChoice =
  | { kind: "everything" }
  | { kind: "toolset"; slug: string }
  | { kind: "tools"; tools: string[] }
  | { kind: "url"; url: string };

export interface ConnectOptions {
  /** `free=1`: only free tools, and calls through it are never charged. */
  free: boolean;
}

export interface ParsedConnectUrl {
  choice: ConnectChoice;
  options: ConnectOptions;
}

/** At most 50 names in `?tools=` (§7.13). */
export const MAX_TOOLS_IN_URL = 50;

const SLUG_RE = /^[a-z0-9-]{2,64}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{1,47}(@[1-9][0-9]{0,5})?$/;

const MCP_NAME_RE = /^[a-z][a-z0-9_-]{1,47}$/;

/**
 * The name a tool goes by in `?tools=`: its catalogue name when that is an MCP
 * tool name (`get_weather`), else its id when that is one (a display name
 * such as "Market quote" is not), else null — such a tool cannot be put in a
 * URL. Never the display name lowercased: "market quote" is not a tool.
 */
export function mcpToolName(tool: { name: string; toolId?: string; id?: string }): string | null {
  if (MCP_NAME_RE.test(tool.name)) return tool.name;
  const id = (tool.toolId ?? tool.id ?? "").toLowerCase();
  return MCP_NAME_RE.test(id) ? id : null;
}

/**
 * How a tool is named on every tool-set screen: by the name an agent calls it
 * by (`get_weather`, `market-quote`), in monospace, with its catalogue title
 * as a second line only when that differs ("Market quote"). One convention
 * for pickers, chips, rows and results.
 */
export function toolDisplay(tool: { name: string; toolId?: string; id?: string }): { name: string; title: string | null } {
  const mcp = mcpToolName(tool);
  if (!mcp) return { name: tool.name, title: null };
  return { name: mcp, title: mcp === tool.name ? null : tool.name };
}

/** Lowercased, trimmed, deduplicated and sorted — the canonical `tools=` list. */
export function canonicalTools(names: readonly string[]): string[] {
  const set = new Set(names.map((name) => name.trim().toLowerCase()).filter((name) => name !== ""));
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The URL for an answer, on `host` (an origin, no trailing slash). */
export function buildMcpUrl(choice: ConnectChoice, options: ConnectOptions = { free: false }, host: string = mcpHost()): string {
  if (choice.kind === "url") return withFree(choice.url, options.free);
  const path = choice.kind === "toolset" ? `/my/${choice.slug}` : "/";
  const query: string[] = [];
  if (choice.kind === "tools") {
    const tools = canonicalTools(choice.tools);
    if (tools.length > 0) query.push(`tools=${tools.join(",")}`);
  }
  if (options.free) query.push("free=1");
  return `${host}${path}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

/** `url` with `free=1` set or removed, other parameters kept in canonical order. */
function withFree(url: string, free: boolean): string {
  const [base, query = ""] = url.split("?");
  const parts = query
    .split("&")
    .filter((part) => part !== "" && !part.startsWith("free="));
  const order = ["tools", "category", "free", "discovery"];
  if (free) parts.push("free=1");
  parts.sort((a, b) => order.indexOf(a.split("=")[0]!) - order.indexOf(b.split("=")[0]!));
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base!;
}

/** `scheme://host` of a URL, lowercased, or null. Works for the unconfigured placeholder host too. */
function originOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * A URL back into the question and its options, for "Change" on a server
 * row and for a Connect panel opened from a browser redirect. `null` when it
 * is not a URL of this MCP host at all ("We couldn't read this URL").
 */
export function parseMcpUrl(url: string, host: string = mcpHost()): ParsedConnectUrl | null {
  const trimmed = url.trim();
  const origin = originOf(trimmed);
  const hostOrigin = originOf(host);
  if (!origin || !hostOrigin || origin !== hostOrigin) return null;
  const rest = trimmed.slice(origin.length).split("#")[0] ?? "";
  const [rawPath = "", rawQuery = ""] = rest.split("?");
  const path = (rawPath === "" ? "/" : rawPath).replace(/%40/gi, "@").toLowerCase();
  if (path.includes("%") || path.includes("//") || path.split("/").some((s) => s === "." || s === "..")) return null;
  const params = new URLSearchParams(rawQuery);
  const free = params.getAll("free").at(-1)?.trim() === "1";
  const tools = canonicalTools((params.get("tools") ?? "").split(","));
  const hasOther = params.has("category") || params.has("discovery");

  if (tools.some((name) => !TOOL_NAME_RE.test(name)) || tools.length > MAX_TOOLS_IN_URL) return null;

  if (path === "/" && !hasOther) {
    return { choice: tools.length > 0 ? { kind: "tools", tools } : { kind: "everything" }, options: { free } };
  }
  const my = /^\/my\/([^/@]+)\/?$/.exec(path);
  if (my && SLUG_RE.test(my[1]!) && tools.length === 0 && !hasOther) {
    return { choice: { kind: "toolset", slug: my[1]! }, options: { free } };
  }
  // Another form of the host (a shared set, a topic, a maker): handed out as it is.
  const cleanPath = path === "/" ? "/" : path.replace(/\/$/, "");
  const query = rawQuery ? `?${rawQuery}` : "";
  return { choice: { kind: "url", url: buildMcpUrl({ kind: "url", url: `${hostOrigin}${cleanPath}${query}` }, { free }) }, options: { free } };
}

/** The same answer, for comparing a choice with the one a row was opened from. */
export function sameChoice(a: ConnectChoice, b: ConnectChoice): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "toolset" && b.kind === "toolset") return a.slug === b.slug;
  if (a.kind === "tools" && b.kind === "tools") return canonicalTools(a.tools).join(",") === canonicalTools(b.tools).join(",");
  if (a.kind === "url" && b.kind === "url") return a.url === b.url;
  return true;
}

/** Leading verbs dropped from a tool name when it names a server: `get_weather` → `weather`. */
const VERBS = new Set(["get", "search", "list", "find", "fetch", "lookup", "read", "run", "call"]);

/** At most 9 characters (§7.1: a client prefix plus a 48-character tool name stays within 64). */
export const MAX_SERVER_NAME = 9;

function clip(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, MAX_SERVER_NAME).replace(/-+$/g, "") || "assay";
}

/**
 * The server name the snippet suggests for an answer, at most 9 characters:
 * `assay` for everything, the tool set's slug, the one tool's noun, or `tools`.
 */
export function suggestServerName(choice: ConnectChoice): string {
  if (choice.kind === "everything") return "assay";
  if (choice.kind === "toolset") return clip(choice.slug);
  if (choice.kind === "tools") {
    const tools = canonicalTools(choice.tools);
    if (tools.length !== 1) return "tools";
    const segments = tools[0]!.split("@")[0]!.split(/[_-]/).filter(Boolean);
    const noun = segments.length > 1 && VERBS.has(segments[0]!) ? segments.slice(1) : segments;
    return clip(noun[0] ?? "tools");
  }
  const path = choice.url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0] ?? "";
  const last = path.split("/").filter(Boolean).at(-1)?.split("@")[0]?.replace(/^@/, "");
  return last ? clip(last) : "assay";
}

/**
 * A suggested server name that no other server of the agent uses: two servers
 * named "weather" in one client would clash (their tools share a prefix).
 * `weather` → `weather2`, `weather3`… within the 9-character cap.
 */
export function uniqueServerName(base: string, taken: readonly (string | null)[]): string {
  const used = new Set(taken.filter((t): t is string => Boolean(t)));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = String(n);
    const candidate = `${base.slice(0, MAX_SERVER_NAME - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}
