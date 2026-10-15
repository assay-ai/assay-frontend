import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  applyIdentityChange,
  isOperatorConsolePath,
  signedOutLanding,
  unauthorizedTarget,
  type BuyerSessionEffects,
} from "./buyer-session";

function effects() {
  const queryClient = {
    invalidateQueries: vi.fn(() => Promise.resolve()),
    resetQueries: vi.fn(() => Promise.resolve()),
  } as unknown as QueryClient;
  const fx = {
    queryClient,
    resetWalletLink: vi.fn(),
    clearSessionToken: vi.fn(),
    getAccessToken: vi.fn(() => Promise.resolve("privy-token")),
    setSessionToken: vi.fn(),
    startWalletLink: vi.fn(),
  } satisfies BuyerSessionEffects;
  return fx;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("isOperatorConsolePath", () => {
  it("matches the console and every page under it", () => {
    expect(isOperatorConsolePath("/operator")).toBe(true);
    expect(isOperatorConsolePath("/operator/approvals")).toBe(true);
    expect(isOperatorConsolePath("/operator/cases/view")).toBe(true);
  });

  it("does not match buyer, provider or look-alike paths", () => {
    expect(isOperatorConsolePath("/")).toBe(false);
    expect(isOperatorConsolePath("/console")).toBe(false);
    expect(isOperatorConsolePath("/operators")).toBe(false);
    expect(isOperatorConsolePath(null)).toBe(false);
  });
});

/**
 * R15: a Privy sign-in on the operator console ran the buyer login path, which
 * called `POST /auth/wallet/link` and provisioned a buyer organization for the
 * operator's Privy identity with its embedded wallet linked.
 */
describe("applyIdentityChange", () => {
  it("does nothing on the operator console: no token write, no wallet link, no cache reset", async () => {
    const fx = effects();
    const result = applyIdentityChange(
      { onOperatorConsole: true, authenticated: true, identity: "did:privy:op", previous: undefined },
      fx,
    );
    await flush();

    expect(fx.getAccessToken).not.toHaveBeenCalled();
    expect(fx.setSessionToken).not.toHaveBeenCalled();
    expect(fx.startWalletLink).not.toHaveBeenCalled();
    expect(fx.resetWalletLink).not.toHaveBeenCalled();
    expect(fx.clearSessionToken).not.toHaveBeenCalled();
    expect(fx.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(fx.queryClient.resetQueries).not.toHaveBeenCalled();
    // Not marked as handled, so a later buyer page still runs the login path.
    expect(result.reacted).toBeUndefined();
  });

  it("does not sign the buyer out when Privy signs out on the operator console", () => {
    const fx = effects();
    const result = applyIdentityChange(
      { onOperatorConsole: true, authenticated: false, identity: null, previous: "did:privy:buyer" },
      fx,
    );
    expect(fx.clearSessionToken).not.toHaveBeenCalled();
    expect(result.reacted).toBe("did:privy:buyer");
  });

  it("stores the token and starts the wallet link on a buyer page", async () => {
    const fx = effects();
    const result = applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:buyer", previous: undefined },
      fx,
    );
    await flush();

    expect(fx.setSessionToken).toHaveBeenCalledWith("privy-token");
    expect(fx.startWalletLink).toHaveBeenCalledTimes(1);
    expect(fx.queryClient.invalidateQueries).toHaveBeenCalled();
    expect(result.reacted).toBe("did:privy:buyer");
  });

  it("runs the login path on the first buyer page after a sign-in on the console", async () => {
    const fx = effects();
    const onConsole = applyIdentityChange(
      { onOperatorConsole: true, authenticated: true, identity: "did:privy:op", previous: undefined },
      fx,
    );
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:op", previous: onConsole.reacted },
      fx,
    );
    await flush();
    expect(fx.startWalletLink).toHaveBeenCalledTimes(1);
  });

  it("skips an unchanged identity and a cancelled token read", async () => {
    const fx = effects();
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:a", previous: "did:privy:a" },
      fx,
    );
    const pending = applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:b", previous: "did:privy:a" },
      fx,
    );
    pending.cancel();
    await flush();
    expect(fx.startWalletLink).not.toHaveBeenCalled();
    expect(fx.queryClient.resetQueries).toHaveBeenCalledTimes(1);
  });
});

describe("unauthorizedTarget", () => {
  it("says the session expired only when this page load had one", () => {
    expect(unauthorizedTarget({ pathname: "/funding", search: "?action=deposit", previous: "did:privy:1" })).toBe(
      "/login?next=%2Ffunding%3Faction%3Ddeposit&reason=expired",
    );
    expect(unauthorizedTarget({ pathname: "/", search: "", previous: "did:privy:1" })).toBe("/login?reason=expired");
  });

  it("sends a first-time visitor at / to How it works, elsewhere to plain sign-in", () => {
    expect(unauthorizedTarget({ pathname: "/", search: "", previous: null })).toBe("/how-it-works");
    expect(unauthorizedTarget({ pathname: "/", search: "", previous: undefined })).toBe("/how-it-works");
    expect(unauthorizedTarget({ pathname: "/provider/setup", search: "", previous: null })).toBe(
      "/login?next=%2Fprovider%2Fsetup",
    );
  });
});

describe("signedOutLanding", () => {
  it("sends a settled, signed-out visitor at / to How it works", () => {
    expect(signedOutLanding({ ready: true, authenticated: false, pathname: "/", demo: false })).toBe("/how-it-works");
  });

  it("does nothing while resolving, when signed in, off /, or on a demo build", () => {
    expect(signedOutLanding({ ready: false, authenticated: false, pathname: "/", demo: false })).toBeNull();
    expect(signedOutLanding({ ready: true, authenticated: true, pathname: "/", demo: false })).toBeNull();
    expect(signedOutLanding({ ready: true, authenticated: false, pathname: "/funding", demo: false })).toBeNull();
    expect(signedOutLanding({ ready: true, authenticated: false, pathname: "/", demo: true })).toBeNull();
  });
});
