/**
 * What the Connect UI shows for each AI client (spec 7.10 item 5, 7.12).
 *
 * - The paid-capable path runs the local `@assay-ai/mcp` proxy, pinned to an
 *   exact version `V`. It carries no key and no header: the proxy signs in and
 *   signs payments on the user's own machine.
 * - The free-only path is the remote URL, for clients that can reach it.
 * - A key in a header is for code the user writes themselves, under "My own
 *   code" (`apiKeyConfig`), and nowhere else.
 *
 * The byte-exact strings live in `commands.vectors.json`, synced from the
 * proxy's own builder (`assay-mcp/vectors/commands.json`); the tests compare
 * against it.
 */
export type McpClient = "claude-code" | "codex" | "cursor" | "vscode" | "windsurf" | "gemini" | "claude-desktop" | "claude-ai" | "chatgpt" | "other";

/** Clients the proxy installs into (paid-capable). */
export type LocalMcpClient = "claude-code" | "codex" | "cursor" | "vscode" | "windsurf" | "gemini" | "claude-desktop";

/** Hosted connectors: free only, never the proxy (H2). */
export type HostedMcpClient = "claude-ai" | "chatgpt";

export const MCP_CLIENTS: readonly { id: McpClient; label: string; file: string }[] = [
  { id: "claude-code", label: "Claude Code", file: "Terminal" },
  { id: "codex", label: "Codex CLI", file: "Terminal" },
  { id: "cursor", label: "Cursor", file: "~/.cursor/mcp.json" },
  { id: "vscode", label: "VS Code", file: "Terminal" },
  { id: "windsurf", label: "Windsurf", file: "~/.config/devin/mcp_config.json" },
  { id: "gemini", label: "Gemini CLI", file: "Terminal" },
  { id: "claude-desktop", label: "Claude Desktop", file: "claude_desktop_config.json" },
  { id: "claude-ai", label: "claude.ai", file: "Settings" },
  { id: "chatgpt", label: "ChatGPT", file: "Settings" },
  { id: "other", label: "My own code", file: "mcp.json" },
];

export function isMcpClient(value: unknown): value is McpClient {
  return typeof value === "string" && MCP_CLIENTS.some((client) => client.id === value);
}

export function isLocalClient(client: McpClient): client is LocalMcpClient {
  return client !== "claude-ai" && client !== "chatgpt" && client !== "other";
}

/** Placeholder shown when the key itself is not on screen (it is shown once, at creation). */
export const KEY_PLACEHOLDER = "PASTE_YOUR_KEY_HERE";

/** The clear-text start of every API key. There is no test-key prefix. */
export const API_KEY_PREFIX = "assay_sk_live_";

/**
 * The most of a key ever shown in clear. The server stores fewer characters;
 * this bound only makes sure a full token passed by mistake is never echoed.
 */
export const KEY_PREFIX_VISIBLE_LENGTH = 22;

/**
 * What stands in for the key when it is not on screen: the API key's own
 * visible prefix, so a person with a key sees which key goes there
 * (`assay_sk_live_ab12…REST_OF_YOUR_KEY`); else the bare placeholder.
 */
export function keyPlaceholder(keyPrefix?: string | null): string {
  const prefix = keyPrefix?.trim().replace(/[.…]+$/, "").slice(0, KEY_PREFIX_VISIBLE_LENGTH);
  return prefix && prefix.startsWith(API_KEY_PREFIX) ? `${prefix}…REST_OF_YOUR_KEY` : KEY_PLACEHOLDER;
}

/** "live" for an API key's visible prefix (`assay_sk_live_…`); null when it does not say. */
export function keyMode(keyPrefix?: string | null): "live" | null {
  return keyPrefix?.trim().startsWith(API_KEY_PREFIX) ? "live" : null;
}

/**
 * The app an OAuth grant was made for, as a credential row carries it
 * (`AgentCredentialDto.oauthClient`, spec §7.10 item 4). Absent or null for an
 * API key.
 */
export interface CredentialOAuthClient {
  name: string;
}

/**
 * A credential row as a key list shows it. An OAuth grant (an app sign-in)
 * has no prefix: it is named by its client, never as "null…".
 */
export interface CredentialLike {
  /** The key's clear-text start; null for an OAuth grant, which has no key to show. */
  prefix: string | null;
  oauthClient?: CredentialOAuthClient | null;
}

export function credentialLabel(credential: CredentialLike): string {
  if (credential.prefix) return `${credential.prefix.replace(/[.…]+$/, "")}…`;
  return credential.oauthClient?.name ? `Signed in with ${credential.oauthClient.name}` : "App sign-in";
}

/** The key an API-key hint names: the first with a prefix. An app sign-in has none to show. */
export function keyForHint<T extends { prefix: string | null }>(keys: readonly T[]): (T & { prefix: string }) | null {
  return (keys.find((key) => key.prefix) as (T & { prefix: string }) | undefined) ?? null;
}

/** An exact version: no range, no tag (R-MCP-14). Same rule as the proxy. */
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
const PACKAGE_NAME = "@assay-ai/mcp";
/** Words a POSIX shell (and zsh) passes through unquoted. */
const SHELL_SAFE = /^[A-Za-z0-9_\-./:@,=+%]+$/;

export function isExactVersion(value: unknown): value is string {
  return typeof value === "string" && EXACT_VERSION.test(value);
}

/**
 * The pinned proxy version, from `NEXT_PUBLIC_ASSAY_MCP_VERSION` (inlined at
 * build time; `next.config.js` fails the build when it is unset or not exact).
 * Throws rather than print an unpinned command.
 */
export function assayMcpVersion(): string {
  const value = process.env.NEXT_PUBLIC_ASSAY_MCP_VERSION;
  if (!isExactVersion(value)) throw new Error("NEXT_PUBLIC_ASSAY_MCP_VERSION must be an exact version such as 1.0.0");
  return value;
}

/** Characters a canonical MCP URL can hold; anything else is refused before it reaches a command (same as the proxy). */
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#@!$&()*+,;=%]+$/;
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_NAME_LENGTH = 56;

/** Thrown for input the proxy's own builder would refuse; never turned into a command. */
export class InstallInputError extends Error {
  override readonly name = "InstallInputError";
}

function checkName(name: string): void {
  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) throw new InstallInputError("invalid server name");
}

function checkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InstallInputError("the URL is not absolute");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new InstallInputError("the URL is not http(s)");
  if (parsed.username || parsed.password || parsed.hash) throw new InstallInputError("the URL has credentials or a fragment");
  if (!URL_CHARS.test(url)) throw new InstallInputError("the URL has characters a canonical URL never has");
}

function shellQuote(word: string): string {
  return SHELL_SAFE.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

function shellLine(words: readonly string[]): string {
  return words.map(shellQuote).join(" ");
}

export interface InstallInput {
  /** The proxy version, pinned exactly. Defaults to the build's `NEXT_PUBLIC_ASSAY_MCP_VERSION`. */
  V?: string;
  /** The canonical MCP URL. */
  url: string;
  /** The server name in the client (spec 8.3.1). */
  name: string;
}

/** True for `{MCP}/` with no query: `{url-args}` is then `--name {name}` only. */
function isRootUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" && u.search === "" && !url.endsWith("?");
  } catch {
    return false;
  }
}

function pinned(input: InstallInput): string {
  const V = input.V ?? assayMcpVersion();
  if (!isExactVersion(V)) throw new Error(`"${V}" is not an exact version`);
  return `${PACKAGE_NAME}@${V}`;
}

function serverArgs(input: InstallInput): string[] {
  checkName(input.name);
  checkUrl(input.url);
  const args = ["-y", pinned(input)];
  if (!isRootUrl(input.url)) args.push("--url", input.url);
  args.push("--name", input.name);
  return args;
}

/** A command (shell line) or a config object, as the proxy's builder returns it. */
export type InstallOutput = string | object;

/** The paid-capable install (user scope): a shell line for CLI clients and VS Code, a config object for file clients. */
export function installCommand(client: LocalMcpClient, input: InstallInput): InstallOutput {
  const args = serverArgs(input);
  switch (client) {
    case "claude-code":
      return shellLine(["claude", "mcp", "add", "--scope", "user", input.name, "--", "npx", ...args]);
    case "codex":
      return shellLine(["codex", "mcp", "add", input.name, "--", "npx", ...args]);
    case "gemini":
      return shellLine(["gemini", "mcp", "add", "--scope", "user", input.name, "npx", ...args]);
    case "vscode":
      return `code --add-mcp ${shellQuote(JSON.stringify({ name: input.name, type: "stdio", command: "npx", args }))}`;
    case "cursor":
    case "windsurf":
    case "claude-desktop":
      return { mcpServers: { [input.name]: { command: "npx", args } } };
  }
}

/** The free-only remote alternative, or null where it is a settings screen. */
export function remoteInstall(client: LocalMcpClient, input: { url: string; name: string }): InstallOutput | null {
  checkUrl(input.url);
  checkName(input.name);
  switch (client) {
    case "claude-code":
      return shellLine(["claude", "mcp", "add", "--transport", "http", "--scope", "user", input.name, input.url]);
    case "codex":
      return shellLine(["codex", "mcp", "add", input.name, "--url", input.url]);
    case "gemini":
      return shellLine(["gemini", "mcp", "add", "--transport", "http", "--scope", "user", input.name, input.url]);
    case "cursor":
      return { mcpServers: { [input.name]: { url: input.url } } };
    case "vscode":
      return { name: input.name, type: "http", url: input.url };
    case "windsurf":
      return { mcpServers: { [input.name]: { serverUrl: input.url } } };
    case "claude-desktop":
      return null;
  }
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The Cursor one-click install link. */
export function cursorDeeplink(input: InstallInput): string {
  const config = utf8Base64(JSON.stringify({ command: "npx", args: serverArgs(input) }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${input.name}&config=${encodeURIComponent(config)}`;
}

/** The VS Code one-click install link. */
export function vscodeDeeplink(input: InstallInput): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: input.name, type: "stdio", command: "npx", args: serverArgs(input) }))}`;
}

/** `npx -y @assay-ai/mcp@V add {url} --client {id}`: also allows the URL for paid calls on a terminal. */
export function addOneLiner(url: string, client: LocalMcpClient, V?: string): string {
  if (url.startsWith("/")) {
    if (!URL_CHARS.test(url)) throw new InstallInputError("invalid path");
  } else {
    checkUrl(url);
  }
  return shellLine(["npx", "-y", pinned({ V, url, name: "" }), "add", url, "--client", client]);
}

/** The URL a hosted connector (claude.ai, ChatGPT) is given: free tools only, so `free=1` is always set (H2). */
export function hostedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.get("free") !== "1") u.searchParams.set("free", "1");
    return u.toString();
  } catch {
    return url;
  }
}

/** What the UI shows instead of a command when the input is refused: never a command. */
export const NO_COMMAND_TEXT = "No command: the server URL or name is not valid. Check the MCP host setting and the server name.";

/** Runs a builder for display: a refusal gives `null`, never a command. */
export function tryBuild<T>(build: () => T): T | null {
  try {
    return build();
  } catch (error) {
    if (error instanceof InstallInputError) return null;
    throw error;
  }
}

/** The URL a client is given, previewed, recorded and copied: one string. Hosted connectors always get `free=1`. */
export function urlForClient(client: McpClient, url: string): string {
  return client === "claude-ai" || client === "chatgpt" ? hostedUrl(url) : url;
}

/** The deep link for a client that has one, else null. */
export function deeplink(client: McpClient, input: InstallInput): string | null {
  if (client === "cursor") return cursorDeeplink(input);
  if (client === "vscode") return vscodeDeeplink(input);
  return null;
}

/** Text to show for an install output: a shell line as is, a config as indented JSON. */
export function installText(output: InstallOutput): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

export interface ApiKeyConfigInput {
  url: string;
  token: string | null;
  keyPrefix?: string | null;
  serverName?: string;
}

/**
 * "My own code": a remote HTTP server entry with the API key in a header. This
 * is the only place a key goes in a config (R-UI-8).
 */
export function apiKeyConfig(input: ApiKeyConfigInput): string {
  const token = input.token ?? keyPlaceholder(input.keyPrefix);
  const name = input.serverName?.trim() || "assay";
  return JSON.stringify({ mcpServers: { [name]: { type: "http", url: input.url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** Where to paste it, per client: one short sentence under the tab. */
export function pasteHint(client: McpClient): string {
  switch (client) {
    case "claude-code":
    case "codex":
    case "gemini":
      return "Requires Node.js. Run this in a terminal. It signs in on first use and signs payments on your own computer.";
    case "vscode":
      return "Requires Node.js. Run this in a terminal, or use the button to install in VS Code.";
    case "cursor":
      return "Requires Node.js. Use the button, or paste this into ~/.cursor/mcp.json, then reload Cursor.";
    case "windsurf":
      return "Requires Node.js. Paste this into ~/.config/devin/mcp_config.json, then restart Windsurf.";
    case "claude-desktop":
      return "Requires Node.js: Claude Desktop starts this server with npx. Paste this into claude_desktop_config.json (Settings › Developer › Edit config), then restart Claude Desktop.";
    case "claude-ai":
    case "chatgpt":
      return "Free tools only. Add the URL as a custom connector in settings, then sign in.";
    case "other":
      return "Code you write yourself: give your MCP client the URL and the header, or this config.";
  }
}
