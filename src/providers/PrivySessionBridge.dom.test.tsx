// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const privy = vi.hoisted(() => ({
  state: { ready: true, authenticated: true, user: { id: "did:privy:1" } as { id: string } | null },
  logout: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("token")),
}));
const nav = vi.hoisted(() => ({ pathname: "/how-it-works", replace: vi.fn() }));
const api = vi.hoisted(() => ({
  handler: null as null | (() => void),
  clearSessionToken: vi.fn(),
}));
const client = vi.hoisted(() => ({
  clear: vi.fn(),
  resetQueries: vi.fn(() => Promise.resolve()),
  invalidateQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...privy.state, getAccessToken: privy.getAccessToken, logout: privy.logout }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock("@/libs/ApiClient", () => ({
  clearSessionToken: api.clearSessionToken,
  setSessionToken: vi.fn(),
  registerSessionTokenProvider: vi.fn(),
  onUnauthorized: (handler: () => void) => {
    api.handler = handler;
  },
}));
vi.mock("@/features/auth/wallet-link", () => ({
  getWalletLinkStatus: () => "linked",
  resetWalletLink: vi.fn(),
  startWalletLink: vi.fn(),
  subscribeWalletLink: () => () => undefined,
}));
vi.mock("@/libs/demo/demo-api", () => ({ demoEnabled: () => false }));

import { PrivySessionBridge } from "./PrivySessionBridge";

function mount() {
  return render(
    <PrivySessionBridge>
      <p>page</p>
    </PrivySessionBridge>,
  );
}

function fire401() {
  act(() => {
    api.handler?.();
  });
}

beforeEach(() => {
  privy.state = { ready: true, authenticated: true, user: { id: "did:privy:1" } };
  nav.pathname = "/how-it-works";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* B5 review n3/m3: the bridge wires the two cache effects, and a public page handles a later expiry. */
describe("PrivySessionBridge on a 401", () => {
  it("on a public page: clears the token, resets (never clears) the cache, signs out, stays", () => {
    mount();
    fire401();
    expect(api.clearSessionToken).toHaveBeenCalled();
    expect(client.resetQueries).toHaveBeenCalled();
    expect(client.clear).not.toHaveBeenCalled();
    expect(privy.logout).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("on a protected page: clears the cache and goes to sign-in", () => {
    nav.pathname = "/funding";
    mount();
    fire401();
    expect(api.clearSessionToken).toHaveBeenCalled();
    expect(client.clear).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/login?next=%2Ffunding&reason=expired");
  });

  it("ignores the rest of the burst, then handles a later expiry after signing in again on the same page", () => {
    const view = mount();
    fire401();
    fire401();
    expect(privy.logout).toHaveBeenCalledTimes(1);

    // The sign-out lands, then the person signs in again without leaving the page.
    privy.state = { ready: true, authenticated: false, user: null };
    view.rerender(
      <PrivySessionBridge>
        <p>page</p>
      </PrivySessionBridge>,
    );
    privy.state = { ready: true, authenticated: true, user: { id: "did:privy:1" } };
    view.rerender(
      <PrivySessionBridge>
        <p>page</p>
      </PrivySessionBridge>,
    );
    vi.clearAllMocks();

    // That session expires too: handled again.
    fire401();
    expect(api.clearSessionToken).toHaveBeenCalled();
    expect(privy.logout).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
