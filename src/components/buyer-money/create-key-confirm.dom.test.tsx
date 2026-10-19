// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CREATE_KEY_CONFIRM_TEXT, McpConfigTabs, createKeyConfirmTitle } from "./mcp-config-tabs";

afterEach(cleanup);

const mount = (onCreateKey: () => void, agentName: string | null = "research-bot") =>
  render(<McpConfigTabs token={null} keyPrefix={null} url="https://mcp.example.com/" client="other" onCreateKey={onCreateKey} agentName={agentName} />);

describe("Use an API key instead asks before it creates a key", () => {
  it("opens a confirm naming the agent; nothing is created on click", () => {
    const create = vi.fn();
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Create an API key for research-bot?")).toBeTruthy();
    expect(screen.getByText(CREATE_KEY_CONFIRM_TEXT)).toBeTruthy();
    expect(CREATE_KEY_CONFIRM_TEXT).toBe("It can call tools with this agent's limits; you see it once.");
  });

  it("Cancel creates nothing and closes", async () => {
    const create = vi.fn();
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(create).not.toHaveBeenCalled();
  });

  it("Create creates the key once", async () => {
    const create = vi.fn();
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("falls back to 'this agent' without a name", () => {
    expect(createKeyConfirmTitle(null)).toBe("Create an API key for this agent?");
    expect(createKeyConfirmTitle("  ")).toBe("Create an API key for this agent?");
  });
});
