// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* Task 1.16 fix round 1 (I2): back to a strict page after sign-in is a full page load. */
const search = vi.hoisted(() => ({ value: "" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const nav = vi.hoisted(() => ({ loadPage: vi.fn() }));
const link = vi.hoisted(() => ({ status: "linked" as string }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, login: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/features/auth/wallet-link", () => ({ useWalletLink: () => link.status }));
vi.mock("@/components/patterns/testnet-chip", () => ({ TestnetChip: () => null }));
vi.mock("@/features/oauth/strict-pages", async (original) => ({
  ...(await original<typeof import("@/features/oauth/strict-pages")>()),
  loadPage: nav.loadPage,
}));

import LoginPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  link.status = "linked";
});

describe("login, signed in, going back", () => {
  it("to the consent page: a full page load", () => {
    search.value = "next=%2Fconnect%2Fauthorize";
    render(<LoginPage />);
    expect(nav.loadPage).toHaveBeenCalledWith("/connect/authorize");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("to the consent page while a new account's wallet is still being set up: stays", () => {
    search.value = "next=%2Fconnect%2Fauthorize";
    link.status = "provisioning";
    const { getByRole, rerender } = render(<LoginPage />);
    expect(nav.loadPage).not.toHaveBeenCalled();
    expect(getByRole("button", { name: /setting up your wallet/i })).toBeTruthy();
    link.status = "linked";
    rerender(<LoginPage />);
    expect(nav.loadPage).toHaveBeenCalledWith("/connect/authorize");
  });

  it("to the consent page when the wallet link gave up: goes, so the page can say so", () => {
    search.value = "next=%2Fconnect%2Fauthorize";
    link.status = "unavailable";
    render(<LoginPage />);
    expect(nav.loadPage).toHaveBeenCalledWith("/connect/authorize");
  });

  it("anywhere else: the client-side replace, as before, without waiting for the wallet", () => {
    link.status = "provisioning";
    search.value = "next=%2Fagents";
    render(<LoginPage />);
    expect(router.replace).toHaveBeenCalledWith("/agents");
    expect(nav.loadPage).not.toHaveBeenCalled();
  });
});
