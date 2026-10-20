// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* "Show paid tools too" on a hosted connector copies the URL without free=1: that is the URL recorded. */
const AGENT = "11111111-1111-1111-1111-111111111111";
const HOST = "https://mcp.example.com";

const toolsets = vi.hoisted(() => ({ recordConnectUrl: vi.fn(), previewMcpUrl: vi.fn(), listAgentServers: vi.fn() }));
vi.mock("@/services/toolsets.service", async (original) => ({
  ...(await original<typeof import("@/services/toolsets.service")>()),
  ...toolsets,
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }), useWallets: () => ({ ready: true, wallets: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/connect" }));

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { Sheet } from "@/components/ui/sheet";

import { ConnectBody } from "./connect-sheet";
import { toolsetKeys } from "./use-toolsets";

function queryClient(): QueryClient {
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

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MCP_URL", `${HOST}/`);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  toolsets.listAgentServers.mockResolvedValue({ servers: [] });
  toolsets.previewMcpUrl.mockImplementation(async ({ url }: { url: string }) => ({ canonicalUrl: url, listedTools: [], tools: [], warnings: [] }));
  toolsets.recordConnectUrl.mockImplementation(async (_agent: string, body: { url: string }) => ({ canonicalUrl: body.url }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.localStorage.clear();
});

const paidToggle = () => screen.getByLabelText("Show paid tools too (they will explain how to pay)");

describe("McpConfigTabs hands the copied hosted URL to onCopy", () => {
  it("free=1 by default, without it once paid tools are shown", () => {
    const onCopy = vi.fn();
    render(<McpConfigTabs token={null} url={`${HOST}/`} client="claude-ai" onCopy={onCopy} />);
    fireEvent.click(screen.getByText(`${HOST}/?free=1`));
    expect(onCopy).toHaveBeenLastCalledWith("claude-ai", `${HOST}/?free=1`);
    fireEvent.click(paidToggle());
    fireEvent.click(screen.getByText(`${HOST}/`));
    expect(onCopy).toHaveBeenLastCalledWith("claude-ai", `${HOST}/`);
  });
});

describe("the Connect sheet records the URL actually copied", () => {
  it("with Show paid tools too, records the URL without free=1", async () => {
    window.localStorage.setItem(`assay.connect.client.${AGENT}`, "claude-ai");
    render(
      <QueryClientProvider client={queryClient()}>
        <Sheet open>
          <ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} />
        </Sheet>
      </QueryClientProvider>,
    );
    await screen.findByTestId("hosted-connector");
    fireEvent.click(paidToggle());
    await act(async () => {
      fireEvent.click(screen.getByText(`${HOST}/`));
    });
    await waitFor(() => expect(toolsets.recordConnectUrl).toHaveBeenCalled());
    const body = toolsets.recordConnectUrl.mock.calls[0]![1] as { url: string; client: string };
    expect(body.url).toBe(`${HOST}/`);
    expect(body.client).toBe("claude-ai");
  });

  it("Done records nothing", async () => {
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={queryClient()}>
        <Sheet open>
          <ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={onDone} />
        </Sheet>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
    expect(toolsets.recordConnectUrl).not.toHaveBeenCalled();
  });
});
