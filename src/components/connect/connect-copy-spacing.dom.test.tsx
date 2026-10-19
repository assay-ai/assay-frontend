// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";

import { HostedConnector } from "./hosted-connector";

/*
  BUG-M1-02: Next's compiler drops the space after `{expr}` in a multi-line
  JSX text run that holds an entity (`&apos;`, `&quot;`), so the page read
  "Ask Claudeto" and "ChatGPTruns". Vitest compiles with esbuild, which keeps
  the space, so the rendered-text tests alone cannot see it: the last test
  compiles the two files with Next's own SWC.
*/
afterEach(cleanup);
const URL_ROOT = "https://mcp.assay.ai/";
const body = () => document.body.textContent ?? "";

describe("Connect copy keeps the space after the app name", () => {
  it.each([
    ["claude-code", "Claude"],
    ["cursor", "Cursor"],
    ["vscode", "VS Code"],
  ] as const)("%s: Ask %s to \"sign in to Assay\"", (client, assistant) => {
    render(<McpConfigTabs guide token={null} url={URL_ROOT} client={client} />);
    expect(body()).toContain(`Ask ${assistant} to "sign in to Assay"`);
  });

  it.each([
    ["chatgpt", "ChatGPT"],
    ["claude-ai", "claude.ai"],
  ] as const)("%s: %s runs connectors", (client, app) => {
    render(<HostedConnector client={client} url={URL_ROOT} />);
    expect(body()).toContain(`Free tools only. ${app} runs connectors from its own servers`);
  });

  it("Next's compiler keeps the space too", async () => {
    const swc = await import("next/dist/build/swc/index.js");
    await swc.loadBindings();
    for (const file of ["src/components/buyer-money/mcp-config-tabs.tsx", "src/components/connect/hosted-connector.tsx"]) {
      const source = readFileSync(path.resolve(file), "utf8");
      const { code } = await swc.transform(source, {
        filename: file,
        jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic", development: true } } },
      });
      expect(code, file).not.toMatch(/\b(app|assistant),\s*"[A-Za-z]/);
    }
  });
});
