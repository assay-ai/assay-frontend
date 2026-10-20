// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const TOKEN = "assay_sk_live_a1b2c3d4e5f6_full_secret_value";
const AGENT = "11111111-1111-1111-1111-111111111111";

const account = vi.hoisted(() => ({
  createCredential: vi.fn(),
  listAgents: vi.fn(),
  listCredentials: vi.fn(),
  renameAgent: vi.fn(),
  revokeCredential: vi.fn(),
}));
vi.mock("@/services/account.service", () => account);
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }), useWallets: () => ({ ready: true, wallets: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/connect" }));

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { Sheet } from "@/components/ui/sheet";

import { ConnectBody } from "./connect-sheet";
import { toolsetKeys } from "./use-toolsets";

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false }, mutations: { retry: false } } });
  qc.setQueryData(["catalogue", "providers"], { providers: [] });
  qc.setQueryData(["catalogue", "tools"], { tools: [] });
  qc.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  qc.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent" }], pageInfo: { nextCursor: null, hasMore: false } });
  qc.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [] });
  qc.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  qc.setQueryData(["spend-policy"], null);
  return qc;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the full key stays in memory (owner rule)", () => {
  it("fills the snippet, and never reaches storage, the URL or the history", async () => {
    account.createCredential.mockResolvedValue({ id: "k1", agentId: AGENT, name: "Key 1", prefix: "assay_sk_live_a1b2", token: TOKEN });
    // The key is made under "My own code": the proxy install carries none.
    window.localStorage.setItem(`assay.connect.client.${AGENT}`, "other");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");

    render(
      <QueryClientProvider client={client()}>
        <Sheet open>
          <ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} />
        </Sheet>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Use an API key instead" }));
    // Nothing is made until the confirm says so.
    expect(account.createCredential).not.toHaveBeenCalled();
    expect(screen.getByText("Create an API key for My agent?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(document.body.textContent).toContain(TOKEN));
    expect(account.createCredential).toHaveBeenCalledWith(AGENT, { name: "Key 1", scopes: ["tools:call"] });

    const leaked = (calls: unknown[][]) => calls.some((args) => JSON.stringify(args).includes(TOKEN));
    expect(leaked(setItem.mock.calls)).toBe(false);
    expect(leaked(replaceState.mock.calls)).toBe(false);
    expect(leaked(pushState.mock.calls)).toBe(false);
    expect(window.location.href).not.toContain(TOKEN);
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) expect(store.getItem(store.key(i)!) ?? "").not.toContain(TOKEN);
    }
    // Copy is on now: the snippet carries the key.
    expect(screen.getByTestId("connect-copy").hasAttribute("disabled")).toBe(false);
  });
});

describe("the no-key line (BUG-M1-04)", () => {
  it("shows under My own code only", async () => {
    window.localStorage.setItem(`assay.connect.client.${AGENT}`, "other");
    render(
      <QueryClientProvider client={client()}>
        <Sheet open>
          <ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} />
        </Sheet>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Use an API key instead" });
    expect(document.body.textContent).toContain("My agent has no key yet. Create one below");
    fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
    await waitFor(() => expect(document.body.textContent).not.toContain("has no key yet"));
    window.localStorage.clear();
  });

  it("hides the key line for a sign-in client once a key exists (M1-04 follow-up)", async () => {
    account.createCredential.mockResolvedValue({ id: "k1", agentId: AGENT, name: "Key 1", prefix: "assay_sk_live_a1b2", token: TOKEN });
    window.localStorage.setItem(`assay.connect.client.${AGENT}`, "other");
    render(
      <QueryClientProvider client={client()}>
        <Sheet open>
          <ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} />
        </Sheet>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use an API key instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByTestId("connect-key-line");
    fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
    await waitFor(() => expect(screen.queryByTestId("connect-key-line")).toBeNull());
    window.localStorage.clear();
  });
});

describe("Copy the URL only (review m4)", () => {
  it("copies the URL without a key and counts as handing it out", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopy = vi.fn();
    render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url="https://mcp.example.com/" client="other" onCopy={onCopy} />);

    fireEvent.click(screen.getByTestId("copy-url-only"));

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith("other"));
    expect(writeText).toHaveBeenCalledWith("https://mcp.example.com/");
  });

  it("is not offered once the snippet has the full key", () => {
    render(<McpConfigTabs token={TOKEN} url="https://mcp.example.com/" client="other" />);
    expect(screen.queryByTestId("copy-url-only")).toBeNull();
  });
});
