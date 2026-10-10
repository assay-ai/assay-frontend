/**
 * The MCP endpoint the `/connect` snippet tells an agent to call.
 *
 * Read from `NEXT_PUBLIC_MCP_URL` (inlined at build time — see
 * `.env.local.example`). No API endpoint reports it, so when it is not
 * configured the snippet keeps a named placeholder rather than a guess: a wrong
 * URL in a copy-paste block costs somebody an afternoon. The placeholder's path
 * is `/mcp`, the one the MCP server actually serves (`/v1`, the old literal,
 * answers 404).
 */
export const MCP_URL_PLACEHOLDER = "https://<your-mcp-endpoint>/mcp";

export function mcpEndpointUrl(configured: string | undefined = process.env.NEXT_PUBLIC_MCP_URL): string {
  const url = configured?.trim().replace(/\/+$/, "");
  return url ? url : MCP_URL_PLACEHOLDER;
}
