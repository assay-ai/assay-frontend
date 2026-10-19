// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import vectors from "@/features/connect/commands.vectors.json";

import { AdvancedUrlKinds } from "./advanced-url-kinds";
import { ClientPicker } from "./client-picker";

afterEach(cleanup);
const URL_ROOT = "https://mcp.assay.ai/";
const body = () => document.body.textContent ?? "";

describe("client picker", () => {
  it("picker lists exactly the 10 labels in order", () => {
    render(<ClientPicker value="claude-code" onChange={() => undefined} />);
    expect(screen.getByText("Which app do you use?")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Claude Code", "Codex", "Cursor", "VS Code", "Windsurf", "Gemini CLI", "Claude Desktop", "claude.ai", "ChatGPT", "My own code",
    ]);
  });
});

describe("one action per client", () => {
  it("Claude Code step 2 command equals the vector with --name assay", () => {
    render(<McpConfigTabs guide token={null} url={URL_ROOT} client="claude-code" />);
    const expected = (vectors.install.find((v) => v.client === "claude-code")!.command as string);
    expect(expected).toContain("--name assay");
    expect(body()).toContain(expected);
    expect(body()).toContain("Needs Node.js 20 or later.");
    expect(body()).toContain("Use Assay to find a free tool for the weather, then get the weather in Lisbon.");
    expect(body()).not.toContain("assay_sk_live_");
    // Spec 9.2 step 2 copy, word for word.
    expect(body()).toContain("Start Claude Code. In the tool list you'll see \"assay_sign_in\". Ask Claude to \"sign in to Assay\"");
    expect(body()).toContain("Try it — ask Claude:");
  });

  it("claude.ai shows https://…/?free=1 and the toggle", () => {
    render(<McpConfigTabs guide token={null} url={URL_ROOT} client="claude-ai" />);
    expect(body()).toContain("https://mcp.assay.ai/?free=1");
    const toggle = screen.getByLabelText("Show paid tools too (they will explain how to pay)") as HTMLInputElement;
    fireEvent.click(toggle);
    expect(body()).not.toContain("?free=1");
  });

  it("Cursor and VS Code get a button and Copy the config instead", () => {
    render(<McpConfigTabs token={null} url={URL_ROOT} client="cursor" />);
    expect(screen.getByTestId("install-deeplink").getAttribute("href")).toMatch(/^cursor:/);
    fireEvent.click(screen.getByText("Copy the config instead"));
    expect(body()).toContain("mcpServers");
  });

  it("Claude Desktop shows the config JSON and the paste text", () => {
    render(<McpConfigTabs token={null} url={URL_ROOT} client="claude-desktop" />);
    expect(body()).toContain("Paste into claude_desktop_config.json (Settings › Developer › Edit config), then restart.");
    expect(body()).toContain("mcpServers");
  });

  it("no money UI before the first call", () => {
    for (const c of ["claude-code", "claude-ai", "cursor"] as const) {
      render(<McpConfigTabs guide token={null} url={URL_ROOT} client={c} />);
      expect(body()).not.toMatch(/Enable paid calls|Deposit|Fund your|Top up|Create your first key/i);
      cleanup();
    }
  });

  it("the API-key snippet and Use an API key appear only under My own code", () => {
    render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url={URL_ROOT} client="claude-code" onCreateKey={() => undefined} />);
    expect(body()).not.toContain("REST_OF_YOUR_KEY");
    expect(body()).not.toContain("Create a key and fill it in");
    cleanup();
    render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url={URL_ROOT} client="other" onCreateKey={() => undefined} />);
    expect(body()).toContain("REST_OF_YOUR_KEY");
  });
});

describe("Advanced", () => {
  it("Advanced lists the 7 rows with §9.5 text", () => {
    render(<AdvancedUrlKinds />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(body()).toContain("Advanced: limit what this agent sees");
    expect(body()).toContain("Search the whole catalogue. About 4 tool definitions.");
    expect(body()).toContain("Add to any URL: free tools only, never charged.");
    expect(body()).toContain("One budget covers every Assay server on this computer.");
  });
});
