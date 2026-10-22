// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestUser = { id: string; linkedAccounts: { type: string; walletClientType?: string; chainType?: string }[] };
const EMBEDDED_EVM = { type: "wallet", walletClientType: "privy", chainType: "ethereum" };
const privy = vi.hoisted(() => ({
  state: {
    ready: true,
    authenticated: true,
    user: { id: "did:privy:1", linkedAccounts: [] } as TestUser | null,
  },
  createWallet: vi.fn(() => Promise.resolve({})),
  logout: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("token")),
}));
const nav = vi.hoisted(() => ({ pathname: "/how-it-works", replace: vi.fn() }));
const api = vi.hoisted(() => ({
  handler: null as null | (() => void),
  clearSessionToken: vi.fn(),
  sentOnlyAs: false,
}));
const link = vi.hoisted(() => ({ refetch: null as null | (() => void) }));
const client = vi.hoisted(() => ({
  clear: vi.fn(),
  resetQueries: vi.fn(() => Promise.resolve()),
  invalidateQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...privy.state, getAccessToken: privy.getAccessToken, logout: privy.logout }),
  useCreateWallet: () => ({ createWallet: privy.createWallet }),
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
  sessionRequestsSentAs: () => (api.sentOnlyAs ? "only" : "unknown"),
  onUnauthorized: (handler: () => void) => {
    api.handler = handler;
  },
}));
vi.mock("@/features/auth/wallet-link", () => ({
  getWalletLinkStatus: () => "linked",
  resetWalletLink: vi.fn(),
  startWalletLink: vi.fn(),
  subscribeWalletLink: () => () => undefined,
  subscribeLinkedRefetch: (listener: () => void) => {
    link.refetch = listener;
    return () => {
      link.refetch = null;
    };
  },
}));
const limits = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("@/features/escrow/after-set-limits", () => ({ stopLimitsRereads: limits.stop }));
vi.mock("@/libs/demo/demo-api", () => ({ demoEnabled: () => false }));
const strict = vi.hoisted(() => ({ loadPage: vi.fn() }));
vi.mock("@/features/oauth/strict-pages", async (original) => {
  const real = await original<typeof import("@/features/oauth/strict-pages")>();
  return {
    ...real,
    loadPage: strict.loadPage,
    // The real branch, with the page load observed instead of performed.
    appNavigate: (...[router, href, options]: Parameters<typeof real.appNavigate>) =>
      real.appNavigate(router, href, { ...options, load: strict.loadPage }),
  };
});

import { RID_STORAGE_KEY } from "@/features/oauth/request-id";

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
  api.sentOnlyAs = false;
  privy.state = { ready: true, authenticated: true, user: { id: "did:privy:1", linkedAccounts: [{ type: "email" }, EMBEDDED_EVM] } };
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
    privy.state = { ready: true, authenticated: true, user: { id: "did:privy:1", linkedAccounts: [{ type: "email" }, EMBEDDED_EVM] } };
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

/* F3: one fetch per query on a signed-in reload, not three. */
describe("PrivySessionBridge, signed-in reload", () => {
  it("refetches the cache when Privy resolves; only the failures when every request already carried this identity's token", () => {
    mount();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    cleanup();
    vi.clearAllMocks();

    api.sentOnlyAs = true;
    mount();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    expect(client.resetQueries).not.toHaveBeenCalled();
  });

  it("a change of identity stops the escrow limits re-reads of the previous one", () => {
    const view = mount();
    vi.clearAllMocks();
    privy.state = { ready: true, authenticated: false, user: null };
    view.rerender(
      <PrivySessionBridge>
        <p>page</p>
      </PrivySessionBridge>,
    );
    expect(limits.stop).toHaveBeenCalledTimes(1);
  });

  it("refetches when the wallet link says the screens need it, and stops listening on unmount", () => {
    api.sentOnlyAs = true;
    const view = mount();
    vi.clearAllMocks();

    act(() => link.refetch?.());
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(client.invalidateQueries).toHaveBeenCalledWith();

    view.unmount();
    expect(link.refetch).toBeNull();
  });
});

/* Task 1.16 fix round 2 (R5): a 401 on a strict page leaves it with a full page load. */
describe("PrivySessionBridge on a 401, on a strict page", () => {
  it("loads the login page as a new document, never through the router", () => {
    nav.pathname = "/connect/authorize";
    window.sessionStorage.setItem(RID_STORAGE_KEY, "a".repeat(43));
    try {
      mount();
      fire401();
      expect(strict.loadPage).toHaveBeenCalledWith("/login?next=%2Fconnect%2Fauthorize&reason=expired");
      expect(nav.replace).not.toHaveBeenCalled();
    } finally {
      window.sessionStorage.removeItem(RID_STORAGE_KEY);
    }
  });

  // BUG-BUY-CONNECT-02: no request to sign in for, so the page says the request is missing.
  it("stays on the consent page when this tab holds no request, and on the error page", () => {
    for (const pathname of ["/connect/authorize", "/connect/authorize-error"]) {
      vi.clearAllMocks();
      nav.pathname = pathname;
      const view = mount();
      fire401();
      expect(strict.loadPage).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("elsewhere, still the router", () => {
    nav.pathname = "/agents";
    mount();
    fire401();
    expect(nav.replace).toHaveBeenCalledWith("/login?next=%2Fagents&reason=expired");
    expect(strict.loadPage).not.toHaveBeenCalled();
  });
});

/* A new account Privy signed in with only its email: the bridge creates the embedded EVM wallet, once. */
describe("PrivySessionBridge, embedded EVM wallet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const emailOnly = (): TestUser => ({ id: "did:privy:new", linkedAccounts: [{ type: "email" }] });
  const rerender = (view: ReturnType<typeof mount>) =>
    view.rerender(
      <PrivySessionBridge>
        <p>page</p>
      </PrivySessionBridge>,
    );

  it("creates it once, after Privy's own createOnLogin had its chance", () => {
    privy.state = { ready: true, authenticated: true, user: emailOnly() };
    const view = mount();
    act(() => vi.advanceTimersByTime(4_999));
    expect(privy.createWallet).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(privy.createWallet).toHaveBeenCalledTimes(1);
    privy.state = { ...privy.state, user: emailOnly() };
    rerender(view);
    act(() => vi.advanceTimersByTime(10_000));
    expect(privy.createWallet).toHaveBeenCalledTimes(1);
  });

  it("never when the account already has one", () => {
    mount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(privy.createWallet).not.toHaveBeenCalled();
  });

  it("not when createOnLogin made it during the wait", () => {
    privy.state = { ready: true, authenticated: true, user: emailOnly() };
    const view = mount();
    act(() => vi.advanceTimersByTime(2_000));
    privy.state = { ...privy.state, user: { id: "did:privy:new", linkedAccounts: [{ type: "email" }, EMBEDDED_EVM] } };
    rerender(view);
    act(() => vi.advanceTimersByTime(10_000));
    expect(privy.createWallet).not.toHaveBeenCalled();
  });

  it("not on the operator console", () => {
    nav.pathname = "/operator";
    privy.state = { ready: true, authenticated: true, user: emailOnly() };
    mount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(privy.createWallet).not.toHaveBeenCalled();
  });
});
