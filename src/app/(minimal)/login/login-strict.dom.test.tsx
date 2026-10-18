// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* Task 1.16 fix round 1 (I2): back to a strict page after sign-in is a full page load. */
const search = vi.hoisted(() => ({ value: "" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const nav = vi.hoisted(() => ({ loadPage: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, login: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/patterns/testnet-chip", () => ({ TestnetChip: () => null }));
vi.mock("@/features/oauth/strict-pages", async (original) => ({
  ...(await original<typeof import("@/features/oauth/strict-pages")>()),
  loadPage: nav.loadPage,
}));

import LoginPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("login, signed in, going back", () => {
  it("to the consent page: a full page load", () => {
    search.value = "next=%2Fconnect%2Fauthorize";
    render(<LoginPage />);
    expect(nav.loadPage).toHaveBeenCalledWith("/connect/authorize");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("anywhere else: the client-side replace, as before", () => {
    search.value = "next=%2Fagents";
    render(<LoginPage />);
    expect(router.replace).toHaveBeenCalledWith("/agents");
    expect(nav.loadPage).not.toHaveBeenCalled();
  });
});
