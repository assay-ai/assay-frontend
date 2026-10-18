// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

/* The consent page around the card: sign-in, load failures, and where it navigates. */
const privy = vi.hoisted(() => ({ value: { ready: true, authenticated: true, user: null, logout: vi.fn() } }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy.value }));
const service = vi.hoisted(() => ({
  getOAuthRequest: vi.fn(),
  approveOAuthRequest: vi.fn(),
  denyOAuthRequest: vi.fn(),
}));
vi.mock("@/services/oauth-consent.service", () => service);
const nav = vi.hoisted(() => ({ loadPage: vi.fn() }));
vi.mock("@/features/oauth/strict-pages", async (original) => ({
  ...(await original<typeof import("@/features/oauth/strict-pages")>()),
  loadPage: nav.loadPage,
}));
vi.mock("@/components/oauth/consent-set-limits", () => ({ ConsentSetLimits: () => null }));

import { RID_STORAGE_KEY } from "@/features/oauth/request-id";

import ConsentPage from "./page";

const RID = "B".repeat(43);
const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x0", decimals: 6 });
const REQUEST = {
  requestId: "r",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  client: { name: "Claude Code", kind: "CIMD", registrableDomain: "claude.ai", host: "claude.ai", verified: true, builtin: false, paymentClient: false },
  returnTo: { kind: "WEB", display: "claude.ai" },
  scope: ["assay:agent"],
  agents: [
    {
      id: "agt-1",
      label: "research-bot",
      active: true,
      limits: { perCall: usd("500000"), perDay: usd("5000000"), freeCallsPerDay: 100 },
      access: { mode: "ALL", summary: "All tools" },
      liveOAuthCredentials: 0,
    },
  ],
  suggestedName: "Claude Code · 2026-10-19",
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConsentPage />
    </QueryClientProvider>,
  );
}

async function armAndApprove() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550));
  });
  act(() => {
    fireEvent.pointerMove(window);
  });
  await act(async () => {
    const button = screen.getByRole("button", { name: "Approve" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MCP_URL", "https://mcp.example.com");
  privy.value = { ready: true, authenticated: true, user: null, logout: vi.fn() };
  window.history.replaceState(null, "", `/connect/authorize#request=${RID}`);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("consent page", () => {
  it("signed out: a full page load to the normal login page; the rid stays in this tab only", async () => {
    privy.value = { ready: true, authenticated: false, user: null, logout: vi.fn() };
    mount();
    await waitFor(() => expect(nav.loadPage).toHaveBeenCalledWith("/login?next=%2Fconnect%2Fauthorize"));
    expect(nav.loadPage.mock.calls[0]![0]).not.toContain(RID);
    expect(window.location.href).not.toContain(RID);
    expect(window.sessionStorage.getItem(RID_STORAGE_KEY)).toBe(RID);
    expect(service.getOAuthRequest).not.toHaveBeenCalled();
  });

  it("an expired request: says so and forgets the rid", async () => {
    service.getOAuthRequest.mockRejectedValue(new ApiError("OAUTH_REQUEST_NOT_FOUND", "x", 404));
    mount();
    await screen.findByText("This request expired. Go back to your app and try again.");
    expect(window.sessionStorage.getItem(RID_STORAGE_KEY)).toBeNull();
  });

  it("approve: goes to the continue URL and forgets the rid", async () => {
    service.getOAuthRequest.mockResolvedValue(REQUEST);
    const redirectTo = `https://mcp.example.com/oauth/authorize/continue?request=${RID}`;
    service.approveOAuthRequest.mockResolvedValue({ redirectTo });
    mount();
    await screen.findByText("Claude Code ✓ Verified");
    await armAndApprove();
    expect(service.approveOAuthRequest).toHaveBeenCalledWith(RID, { agentId: "agt-1", name: "Claude Code · 2026-10-19" });
    expect(nav.loadPage).toHaveBeenCalledWith(redirectTo);
    expect(window.sessionStorage.getItem(RID_STORAGE_KEY)).toBeNull();
  });

  it("a redirectTo that is not the continue step: no navigation", async () => {
    service.getOAuthRequest.mockResolvedValue(REQUEST);
    service.approveOAuthRequest.mockResolvedValue({ redirectTo: "https://evil.example/oauth/authorize/continue?request=x" });
    mount();
    await screen.findByText("Claude Code ✓ Verified");
    await armAndApprove();
    expect(nav.loadPage).not.toHaveBeenCalled();
    expect(screen.getByText("Assay could not send you back to the app. Go back to your app and try again.")).toBeTruthy();
  });
});
