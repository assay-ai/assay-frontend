/**
 * The MCP host an agent connects to, e.g. `https://mcp.goassay.ai/`.
 *
 * Read from `NEXT_PUBLIC_MCP_URL` (inlined at build time — see
 * `.env.local.example`). Every MCP URL sits at the root of that host: `/` is
 * everything, `/my/{slug}` is one of your tool sets. There is no `/mcp` path
 * any more, so only the origin of the configured value is kept (an old
 * `…/mcp` value still yields the right host).
 *
 * No API endpoint reports it, so when it is not configured the snippet keeps a
 * named placeholder rather than a guess: a wrong URL in a copy-paste block
 * costs somebody an afternoon.
 */
export const MCP_HOST_PLACEHOLDER = "https://<your-mcp-host>";
export const MCP_URL_PLACEHOLDER = `${MCP_HOST_PLACEHOLDER}/`;

/** The MCP host's origin, with no trailing slash: `https://mcp.goassay.ai`. */
export function mcpHost(configured: string | undefined = process.env.NEXT_PUBLIC_MCP_URL): string {
  const raw = configured?.trim();
  if (!raw) return MCP_HOST_PLACEHOLDER;
  try {
    return new URL(raw).origin;
  } catch {
    return MCP_HOST_PLACEHOLDER;
  }
}

/** The root MCP URL, `https://mcp.goassay.ai/`: the whole catalogue. What the first run hands out. */
export function mcpEndpointUrl(configured: string | undefined = process.env.NEXT_PUBLIC_MCP_URL): string {
  return `${mcpHost(configured)}/`;
}
