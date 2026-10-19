/**
 * The MCP config to paste, per client. One tab per client because each reads
 * a different file (or command) in a different shape; one generic block made
 * people translate it themselves.
 *
 * - Claude Code takes a one-line `claude mcp add` command.
 * - Claude Desktop only starts local (stdio) servers from its config file, so a
 *   remote URL goes through `mcp-remote`, with the key passed as an env var.
 * - Cursor and most other clients take the URL and headers directly.
 *
 * The client ids are the ones `POST /agents/:id/connect-urls` remembers.
 */
export type McpClient = "claude-code" | "claude-desktop" | "cursor" | "other";

export const MCP_CLIENTS: readonly { id: McpClient; label: string; file: string }[] = [
  { id: "claude-code", label: "Claude Code", file: "Terminal" },
  { id: "claude-desktop", label: "Claude Desktop", file: "claude_desktop_config.json" },
  { id: "cursor", label: "Cursor", file: "~/.cursor/mcp.json" },
  { id: "other", label: "Other", file: "mcp.json" },
];

export function isMcpClient(value: unknown): value is McpClient {
  return typeof value === "string" && MCP_CLIENTS.some((client) => client.id === value);
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

/** A shell word: bare when it is plainly safe, else in double quotes (`?` and `&` mean something to a shell). */
function shellWord(text: string): string {
  return /^[A-Za-z0-9:/._@%+=,-]+$/.test(text) && !text.includes("?") ? text : `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
}

export interface McpConfigInput {
  url: string;
  token: string | null;
  keyPrefix?: string | null;
  /** The server's name in the client, free-form within a per-URL budget (§8.3.1). Default `assay`. */
  serverName?: string;
}

export function mcpConfig(client: McpClient, input: McpConfigInput): string {
  const token = input.token ?? keyPlaceholder(input.keyPrefix);
  const name = input.serverName?.trim() || "assay";
  if (client === "claude-code") {
    return `claude mcp add --transport http ${shellWord(name)} ${shellWord(input.url)} --header "Authorization: Bearer ${token}"`;
  }
  if (client === "claude-desktop") {
    return JSON.stringify(
      {
        mcpServers: {
          [name]: {
            command: "npx",
            args: ["-y", "mcp-remote", input.url, "--header", "Authorization:${ASSAY_AUTH}"],
            env: { ASSAY_AUTH: `Bearer ${token}` },
          },
        },
      },
      null,
      2,
    );
  }
  if (client === "cursor") {
    return JSON.stringify({ mcpServers: { [name]: { url: input.url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  }
  return JSON.stringify(
    { mcpServers: { [name]: { type: "http", url: input.url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

/** Where to paste it, per client: one short sentence under the tab. */
export function pasteHint(client: McpClient): string {
  switch (client) {
    case "claude-code":
      return "Run this in a terminal. Claude Code adds the server for this project.";
    case "claude-desktop":
      return "Requires Node.js: Claude Desktop starts this server with npx. Paste this into claude_desktop_config.json (Settings › Developer › Edit config), then restart Claude Desktop.";
    case "cursor":
      return "Paste this into ~/.cursor/mcp.json, then reload Cursor.";
    case "other":
      return "Any MCP client that speaks Streamable HTTP: give it the URL and the header, or this config.";
  }
}
