import { mcpHost } from "./mcp-endpoint";

/**
 * MCP server URLs as the Connect sheet builds and reads them (design spec
 * §7.4, §7.11). The sheet asks one question, "What should it use?", and each
 * answer is one URL on the MCP host:
 *
 * ```text
 * Everything                 /
 * One topic                  /c/{category}
 * One maker                  /@{handle}
 * One of my tool sets        /my/{slug}             ("Lock to vN": /my/{slug}@N)
 * A shared tool set          /@{handle}/{slug}@N    ("Always latest": no @N)
 * A link-only tool set       /u/{token}@N
 * Only these tools           /?tools=a,b,c
 * + "Only free tools"        …free=1
 * + "How the agent sees tools" …discovery=full|search|auto, only when it differs
 *                            from the URL's default: the root searches; a
 *                            `?tools=` URL, a topic and a maker are automatic;
 *                            a tool set's default is its own setting.
 * ```
 *
 * The URL is written in the backend's canonical form (tools deduplicated and
 * sorted, parameters in a fixed order, commas unescaped), so the URL a person
 * copies is the same string the server attributes calls to and lists under
 * Servers in use.
 *
 * Any other URL of the host (a `?category=` filter, `?tools=` on a tool set)
 * is kept as it is — `{ kind: "url" }` — so a Connect panel opened from such a
 * page still hands out exactly that URL.
 */
export type ConnectChoice =
  | { kind: "everything" }
  | { kind: "topic"; category: string }
  | { kind: "maker"; handle: string }
  | { kind: "toolset"; slug: string; version?: number | null }
  | { kind: "shared"; handle: string; slug: string; version?: number | null }
  | { kind: "link"; token: string; version?: number | null }
  | { kind: "tools"; tools: string[] }
  | { kind: "url"; url: string };

/** `discovery=` values. The screens say "Automatic", "Show all tools", "Let the agent search". */
export type DiscoveryChoice = "auto" | "full" | "search";

export interface ConnectOptions {
  /** `free=1`: only free tools, and calls through it are never charged. */
  free: boolean;
  /** `discovery=`; omitted, or equal to the URL's default, adds nothing. */
  discovery?: DiscoveryChoice | null;
}

export interface ParsedConnectUrl {
  choice: ConnectChoice;
  options: ConnectOptions;
}

/** At most 50 names in `?tools=` (§7.13). */
export const MAX_TOOLS_IN_URL = 50;

const SLUG_RE = /^[a-z0-9-]{2,64}$/;
const HANDLE_RE = /^[a-z][a-z0-9-]{2,23}$/;
const CATEGORY_RE = /^[a-z][a-z0-9-]{1,63}$/;
const TOKEN_RE = /^[a-z0-9_-]{22,64}$/;
const VERSION_RE = /^[1-9][0-9]{0,5}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{1,47}(@[1-9][0-9]{0,5})?$/;
const DISCOVERY_VALUES: readonly string[] = ["auto", "full", "search"];

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

/**
 * The discovery mode a URL has with no `discovery=`: the root searches; a
 * `?tools=` URL, a topic and a maker are automatic. A tool set's default is
 * its own setting, which its URL does not show (null).
 */
export function defaultDiscovery(choice: ConnectChoice): DiscoveryChoice | null {
  switch (choice.kind) {
    case "everything":
      return "search";
    case "tools":
      return choice.tools.length > 0 ? "auto" : "search";
    case "topic":
    case "maker":
      return "auto";
    default:
      return null;
  }
}

export type ToolsetChoice = Extract<ConnectChoice, { kind: "toolset" | "shared" | "link" }>;

/** Whether a choice serves a tool set, whose versions can be locked. */
export function isToolsetChoice(choice: ConnectChoice | null | undefined): choice is ToolsetChoice {
  return choice?.kind === "toolset" || choice?.kind === "shared" || choice?.kind === "link";
}

function at(version: number | null | undefined): string {
  return version && version > 0 ? `@${version}` : "";
}

function pathOf(choice: Exclude<ConnectChoice, { kind: "url" }>): string {
  switch (choice.kind) {
    case "topic":
      return `/c/${choice.category}`;
    case "maker":
      return `/@${choice.handle}`;
    case "toolset":
      return `/my/${choice.slug}${at(choice.version)}`;
    case "shared":
      return `/@${choice.handle}/${choice.slug}${at(choice.version)}`;
    case "link":
      return `/u/${choice.token}${at(choice.version)}`;
    default:
      return "/";
  }
}

/** The URL for an answer, on `host` (an origin, no trailing slash). */
export function buildMcpUrl(choice: ConnectChoice, options: ConnectOptions = { free: false }, host: string = mcpHost()): string {
  if (choice.kind === "url") return withOptions(choice.url, options);
  const query: string[] = [];
  if (choice.kind === "tools") {
    const tools = canonicalTools(choice.tools);
    if (tools.length > 0) query.push(`tools=${tools.join(",")}`);
  }
  if (options.free) query.push("free=1");
  if (options.discovery && options.discovery !== defaultDiscovery(choice)) query.push(`discovery=${options.discovery}`);
  return `${host}${pathOf(choice)}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

/** `url` with `free=1` (and `discovery=` when one is given) set or removed, other parameters in canonical order. */
function withOptions(url: string, options: ConnectOptions): string {
  const [base, query = ""] = url.split("?");
  const parts = query
    .split("&")
    .filter((part) => part !== "" && !part.startsWith("free=") && (options.discovery === undefined || !part.startsWith("discovery=")));
  const order = ["tools", "category", "free", "discovery"];
  if (options.free) parts.push("free=1");
  if (options.discovery) parts.push(`discovery=${options.discovery}`);
  parts.sort((a, b) => order.indexOf(a.split("=")[0]!) - order.indexOf(b.split("=")[0]!));
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base!;
}

/** `scheme://host` of a URL, lowercased, or null. Works for the unconfigured placeholder host too. */
function originOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** `name@3` → `{ name, version: 3 }`; null when what follows `@` is not a version. */
function splitVersion(segment: string): { name: string; version: number | null } | null {
  const i = segment.lastIndexOf("@");
  if (i <= 0) return { name: segment, version: null };
  const v = segment.slice(i + 1);
  return VERSION_RE.test(v) ? { name: segment.slice(0, i), version: Number(v) } : null;
}

/** The answer a path stands for, or null when it is not one of the forms in §7.4. */
function choiceOfPath(path: string): ConnectChoice | null {
  if (path === "/") return { kind: "everything" };
  const [first = "", ...rest] = path.replace(/\/$/, "").slice(1).split("/");
  if (first.startsWith("@")) {
    const handle = first.slice(1);
    if (!HANDLE_RE.test(handle)) return null;
    if (rest.length === 0) return { kind: "maker", handle };
    if (rest.length !== 1) return null;
    const pinned = splitVersion(rest[0]!);
    return pinned && SLUG_RE.test(pinned.name) ? { kind: "shared", handle, slug: pinned.name, version: pinned.version } : null;
  }
  if (rest.length !== 1) return null;
  const second = rest[0]!;
  if (first === "c") return CATEGORY_RE.test(second) ? { kind: "topic", category: second } : null;
  if (first !== "my" && first !== "u") return null;
  const pinned = splitVersion(second);
  if (!pinned) return null;
  if (first === "my") return SLUG_RE.test(pinned.name) ? { kind: "toolset", slug: pinned.name, version: pinned.version } : null;
  return TOKEN_RE.test(pinned.name) ? { kind: "link", token: pinned.name, version: pinned.version } : null;
}

/** Drops an unset version, so a parsed choice equals the one that was built. */
function tidy(choice: ConnectChoice): ConnectChoice {
  if (isToolsetChoice(choice) && !choice.version) {
    const { version: _version, ...rest } = choice;
    return rest as ConnectChoice;
  }
  return choice;
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
  const rawDiscovery = params.getAll("discovery").at(-1)?.trim().toLowerCase() ?? null;
  if (rawDiscovery !== null && !DISCOVERY_VALUES.includes(rawDiscovery)) return null;
  if (tools.some((name) => !TOOL_NAME_RE.test(name)) || tools.length > MAX_TOOLS_IN_URL) return null;

  const pathChoice = choiceOfPath(path);
  let choice: ConnectChoice;
  if (pathChoice && !params.has("category") && (tools.length === 0 || pathChoice.kind === "everything")) {
    choice = tools.length > 0 ? { kind: "tools", tools } : tidy(pathChoice);
  } else {
    // Another form of the host: handed out as it is, filters and all.
    const cleanPath = path === "/" ? "/" : path.replace(/\/$/, "");
    const query = rawQuery ? `?${rawQuery}` : "";
    choice = { kind: "url", url: withOptions(`${hostOrigin}${cleanPath}${query}`, { free }) };
  }
  const discovery = rawDiscovery as DiscoveryChoice | null;
  const keep = discovery !== null && choice.kind !== "url" && discovery !== defaultDiscovery(choice);
  return { choice, options: keep ? { free, discovery } : { free } };
}

/** The same answer, for comparing a choice with the one a row was opened from. */
export function sameChoice(a: ConnectChoice, b: ConnectChoice): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "url" && b.kind === "url") return a.url === b.url;
  return buildMcpUrl(a, { free: false }, "h:") === buildMcpUrl(b, { free: false }, "h:");
}

/** Leading verbs dropped from a tool name when it names a server: `get_weather` → `weather`. */
const VERBS = new Set(["get", "search", "list", "find", "fetch", "lookup", "read", "run", "call"]);

/** At most 9 characters (§7.1: a client prefix plus a 48-character tool name stays within 64). */
export const MAX_SERVER_NAME = 9;

/**
 * A name of at most 9 characters, never cut mid-word: the whole text, else
 * the whole text without its dashes ("tools-i-use" → "toolsiuse"), else whole
 * words from the start while they fit ("weather-and-places" → "weather"),
 * never ending on a one- or two-letter word ("tools-i" names nothing), else
 * the last word when that fits ("web-research" → "research"), and only a word
 * too long for any of that is cut.
 */
function clip(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length <= MAX_SERVER_NAME) return cleaned || "assay";
  const words = cleaned.split("-").filter(Boolean);
  const joined = words.join("");
  if (joined.length <= MAX_SERVER_NAME) return joined;
  const kept: string[] = [];
  for (const word of words) {
    if ([...kept, word].join("-").length > MAX_SERVER_NAME) break;
    kept.push(word);
  }
  while (kept.length > 1 && kept.at(-1)!.length <= 2) kept.pop();
  const head = kept.join("-");
  if (head.length >= 4) return head;
  const last = words.at(-1) ?? "";
  if (last.length >= 4 && last.length <= MAX_SERVER_NAME) return last;
  return (head || cleaned.slice(0, MAX_SERVER_NAME)).replace(/-+$/g, "") || "assay";
}

/**
 * The server name the snippet suggests for an answer, at most 9 characters:
 * `assay` for everything, the tool set's slug, the topic, the maker, the one
 * tool's noun, or `tools`.
 */
export function suggestServerName(choice: ConnectChoice): string {
  switch (choice.kind) {
    case "everything":
      return "assay";
    case "toolset":
    case "shared":
      return clip(choice.slug);
    case "topic":
      return clip(choice.category);
    case "maker":
      return clip(choice.handle);
    case "link":
      return "shared";
    case "tools": {
      const tools = canonicalTools(choice.tools);
      if (tools.length !== 1) return "tools";
      const segments = tools[0]!.split("@")[0]!.split(/[_-]/).filter(Boolean);
      const noun = segments.length > 1 && VERBS.has(segments[0]!) ? segments.slice(1) : segments;
      return clip(noun[0] ?? "tools");
    }
    default: {
      const path = choice.url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0] ?? "";
      const last = path.split("/").filter(Boolean).at(-1)?.split("@")[0]?.replace(/^@/, "");
      return last ? clip(last) : "assay";
    }
  }
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

/**
 * The web page an MCP URL opens in a browser (§7.4 mapping), for links from
 * the app to a shared tool set's page. The unlisted token rides in the
 * fragment, so it never reaches a server log or a referrer.
 */
export function webPageOf(choice: ConnectChoice): string | null {
  switch (choice.kind) {
    case "shared":
      return `/toolsets/view?handle=${choice.handle}&slug=${choice.slug}${choice.version ? `&v=${choice.version}` : ""}`;
    case "link":
      return `/toolsets/view#token=${choice.token}${choice.version ? `&v=${choice.version}` : ""}`;
    case "maker":
      return `/toolsets/handle?handle=${choice.handle}`;
    case "toolset":
      return `/toolsets/mine?slug=${choice.slug}${choice.version ? `&v=${choice.version}` : ""}`;
    case "topic":
      return `/catalogue?category=${choice.category}`;
    default:
      return null;
  }
}
