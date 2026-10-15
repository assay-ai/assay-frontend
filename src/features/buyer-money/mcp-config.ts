/**
 * The MCP config to paste, per client. Three tabs because each client reads a
 * different file in a different shape; one generic block made people translate
 * it themselves.
 *
 * - Claude Desktop only starts local (stdio) servers from its config file, so a
 *   remote URL goes through `mcp-remote`, with the key passed as an env var.
 * - Cursor and most other clients take the URL and headers directly.
 */
export type McpClient = "claude-desktop" | "cursor" | "other";

export const MCP_CLIENTS: readonly { id: McpClient; label: string; file: string }[] = [
  { id: "claude-desktop", label: "Claude Desktop", file: "claude_desktop_config.json" },
  { id: "cursor", label: "Cursor", file: "~/.cursor/mcp.json" },
  { id: "other", label: "Other MCP client", file: "mcp.json" },
];

/** Placeholder shown when the key itself is not on screen (it is shown once, at creation). */
export const KEY_PLACEHOLDER = "PASTE_YOUR_KEY_HERE";

export function mcpConfig(client: McpClient, input: { url: string; token: string | null }): string {
  const token = input.token ?? KEY_PLACEHOLDER;
  if (client === "claude-desktop") {
    return JSON.stringify(
      {
        mcpServers: {
          assay: {
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
    return JSON.stringify(
      { mcpServers: { assay: { url: input.url, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      mcpServers: {
        assay: { type: "http", url: input.url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
}
