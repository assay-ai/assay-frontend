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
 * First path segments the MCP host keeps for itself (sharing links, discovery,
 * health, docs, the OAuth endpoints). A URL under one is never an MCP URL.
 */
export const RESERVED_FIRST_SEGMENTS: readonly string[] = ["t", ".well-known", "health", "status", "docs", "oauth"];

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
  if (RESERVED_FIRST_SEGMENTS.includes(path.split("/")[1] ?? "")) return null;
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

/**
 * The server-name rule of spec 8.3.1 (O5), the same one `assay-mcp` computes
 * (`vectors/server-names.json` is the shared source of truth): a name `s` fits
 * a URL when `overhead + len(s) + L <= budget`, where `L` is the longest tool
 * name the URL can expose to the agent.
 */
export interface NameRule {
  budget: number;
  overhead: number;
}

export const DEFAULT_NAME_RULE: NameRule = { budget: 64, overhead: 7 };
/** Longest tool name assumed when the URL has not been measured (toolsets spec NFR-7). */
export const SIGNED_OUT_TOOL_LENGTH = 48;
/** The tool shown before sign-in; always counted. */
export const SIGN_IN_TOOL = "assay_sign_in";
/** `agent_connect_urls.server_name` is varchar(56). */
export const MAX_SERVER_NAME_LENGTH = 56;
export const SIGN_IN_HINT = "Sign in first (`assay-mcp login`) to allow a longer name.";

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** `_` is excluded so a name never blurs the `__` separator of a client's tool prefix. */
export function isValidServerName(name: string): boolean {
  return NAME_PATTERN.test(name) && name.length <= MAX_SERVER_NAME_LENGTH;
}

/** The longest name that fits a URL whose longest tool is `longestTool` characters (0 or less: none fits). */
export function maxServerNameLength(longestTool: number, rule: NameRule = DEFAULT_NAME_RULE): number {
  return rule.budget - rule.overhead - longestTool;
}

export function fitsServerName(name: string, longestTool: number, rule: NameRule = DEFAULT_NAME_RULE): boolean {
  return isValidServerName(name) && rule.overhead + name.length + longestTool <= rule.budget;
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * L: the longest name `tools/list` returns for this agent at the URL, with
 * `assay_sign_in` always counted. Measured in UTF-8 bytes. `null` (not yet
 * measured, or signed out) is the upper bound 48.
 */
export function longestToolLength(listedTools: readonly string[] | null | undefined): number {
  if (!listedTools) return SIGNED_OUT_TOOL_LENGTH;
  return Math.max(SIGN_IN_TOOL.length, ...listedTools.map(utf8Length));
}

/** Drops trailing dash-separated words of `name` until it fits; `assay` if nothing else does; `null` if nothing fits. */
function suggestFit(name: string, longestTool: number, rule: NameRule): string | null {
  const words = name.split("-").filter(Boolean);
  while (words.length > 0) {
    const candidate = words.join("-");
    if (fitsServerName(candidate, longestTool, rule)) return candidate;
    words.pop();
  }
  return fitsServerName("assay", longestTool, rule) ? "assay" : null;
}

/** `assay` for the root; `assay-{slug}` otherwise, dropping trailing words, then `assay`. */
export function defaultServerNameFor(
  root: boolean,
  slugWords: readonly string[],
  longestTool: number = SIGNED_OUT_TOOL_LENGTH,
  rule: NameRule = DEFAULT_NAME_RULE,
): string {
  if (root) return "assay";
  const words = slugWords.map((w) => w.toLowerCase());
  if (words.some((w) => !/^[a-z0-9]+$/.test(w))) return "assay";
  while (words.length > 0) {
    const candidate = `assay-${words.join("-")}`;
    if (fitsServerName(candidate, longestTool, rule)) return candidate;
    words.pop();
  }
  return "assay";
}

const words = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter(Boolean);

/** The slug words of an answer: the tool set slug, topic, maker, or the one tool's noun (`[]` for the root). */
function slugWordsOf(choice: ConnectChoice): string[] | null {
  switch (choice.kind) {
    case "everything":
      return null;
    case "toolset":
    case "shared":
      return words(choice.slug);
    case "topic":
      return words(choice.category);
    case "maker":
      return words(choice.handle);
    case "link":
      return ["shared"];
    case "tools": {
      const tools = canonicalTools(choice.tools);
      if (tools.length !== 1) return ["tools"];
      const segments = tools[0]!.split("@")[0]!.split(/[_-]/).filter(Boolean);
      const noun = segments.length > 1 && VERBS.has(segments[0]!) ? segments.slice(1) : segments;
      return noun[0] ? [noun[0]] : ["tools"];
    }
    default: {
      const path = choice.url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0] ?? "";
      const last = path.split("/").filter(Boolean).at(-1)?.split("@")[0]?.replace(/^@/, "");
      return last ? words(last) : null;
    }
  }
}

/**
 * The server name the snippet suggests for an answer: `assay` for everything,
 * else `assay-{slug}` (`assay-weather`, `assay-twitter-kit`), dropping trailing
 * slug words until it fits `longestTool`, then `assay`. Shown, never silent.
 */
export function defaultServerName(choice: ConnectChoice, longestTool: number = SIGNED_OUT_TOOL_LENGTH, rule: NameRule = DEFAULT_NAME_RULE): string {
  const slug = slugWordsOf(choice);
  return slug === null || slug.length === 0 ? "assay" : defaultServerNameFor(false, slug, longestTool, rule);
}

export interface ServerNameRefusal {
  kind: "invalid" | "tooLong";
  message: string;
}

/**
 * Why a typed name is refused (`null` when it is accepted): not a valid name,
 * or valid but too long for this URL. Never truncates silently.
 */
export function serverNameRefusal(name: string, longestTool: number, rule: NameRule = DEFAULT_NAME_RULE): ServerNameRefusal | null {
  if (!NAME_PATTERN.test(name)) {
    return { kind: "invalid", message: `\`${name}\` is not a valid name: use lowercase letters, digits and \`-\`, starting with a letter.` };
  }
  const max = Math.min(maxServerNameLength(longestTool, rule), MAX_SERVER_NAME_LENGTH);
  if (name.length <= max) return null;
  const head = `\`${name}\` is too long for this server: its longest tool is ${longestTool} characters,`;
  if (max <= 0) return { kind: "tooLong", message: `${head} so no name fits.` };
  const suggestion = suggestFit(name, longestTool, rule);
  const body = `${head} so the name can be at most ${max}.`;
  return { kind: "tooLong", message: suggestion === null ? body : `${body} Try \`${suggestion}\`.` };
}

/**
 * The first of `base`, `base-2`, `base-3`, … that no other server of the agent
 * uses and that fits the budget (the base is trimmed, never the suffix): two
 * servers with one name in one client would clash.
 */
export function uniqueServerName(
  base: string,
  taken: readonly (string | null)[],
  longestTool: number = SIGNED_OUT_TOOL_LENGTH,
  rule: NameRule = DEFAULT_NAME_RULE,
): string {
  const used = new Set(taken.filter((t): t is string => Boolean(t)));
  if (!used.has(base)) return base;
  const room = Math.min(maxServerNameLength(longestTool, rule), MAX_SERVER_NAME_LENGTH);
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const head = base.slice(0, Math.max(0, room - suffix.length)).replace(/-+$/, "");
    if (head === "") break;
    const candidate = `${head}${suffix}`;
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
