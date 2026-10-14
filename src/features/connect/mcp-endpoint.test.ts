import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_URL_PLACEHOLDER, mcpEndpointUrl } from "./mcp-endpoint";

describe("mcpEndpointUrl — the URL the /connect snippet hands an agent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured public MCP URL", () => {
    expect(mcpEndpointUrl("http://localhost:3200/mcp")).toBe("http://localhost:3200/mcp");
  });

  it("trims whitespace and a trailing slash", () => {
    expect(mcpEndpointUrl("  https://mcp.example.com/mcp/ ")).toBe("https://mcp.example.com/mcp");
  });

  it("falls back to a named placeholder, on the path the MCP server serves", () => {
    // The old literal ended in `/v1`, which the MCP server answers 404; it serves `/mcp`.
    // `undefined` falls through to NEXT_PUBLIC_MCP_URL, which a deploy build sets.
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "");
    expect(mcpEndpointUrl(undefined)).toBe(MCP_URL_PLACEHOLDER);
    expect(mcpEndpointUrl("")).toBe(MCP_URL_PLACEHOLDER);
    expect(MCP_URL_PLACEHOLDER).toBe("https://<your-mcp-endpoint>/mcp");
  });
});
