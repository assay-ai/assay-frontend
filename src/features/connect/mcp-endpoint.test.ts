import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_URL_PLACEHOLDER, mcpEndpointUrl, mcpHost } from "./mcp-endpoint";

describe("mcpEndpointUrl — the MCP host root the snippets hand an agent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the root of the configured MCP host", () => {
    expect(mcpEndpointUrl("https://mcp.example.com/")).toBe("https://mcp.example.com/");
    expect(mcpEndpointUrl("http://localhost:3200")).toBe("http://localhost:3200/");
  });

  it("keeps only the origin, so an old `/mcp` value still names the right host", () => {
    expect(mcpEndpointUrl("  https://mcp.example.com/mcp/ ")).toBe("https://mcp.example.com/");
    expect(mcpHost("http://localhost:3200/mcp")).toBe("http://localhost:3200");
  });

  it("falls back to a named placeholder when unset or unreadable", () => {
    // `undefined` falls through to NEXT_PUBLIC_MCP_URL, which a deploy build sets.
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "");
    expect(mcpEndpointUrl(undefined)).toBe(MCP_URL_PLACEHOLDER);
    expect(mcpEndpointUrl("")).toBe(MCP_URL_PLACEHOLDER);
    expect(mcpEndpointUrl("not a url")).toBe(MCP_URL_PLACEHOLDER);
    expect(MCP_URL_PLACEHOLDER).toBe("https://<your-mcp-host>/");
  });
});
