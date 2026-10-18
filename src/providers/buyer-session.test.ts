import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  applyIdentityChange,
  handleUnauthorized,
  isOperatorConsolePath,
  isPublicPath,
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

  // A2 (2026-10-18): a stale token on :4001 turned `/` → How it works → /login?next=%2Fhow-it-works.
  it("keeps a public page where it is, with or without a session", () => {
    for (const previous of [null, undefined, "did:privy:1"]) {
      expect(unauthorizedTarget({ pathname: "/how-it-works", search: "", previous })).toBe("/how-it-works");
      expect(unauthorizedTarget({ pathname: "/catalogue", search: "?view=providers", previous })).toBe(
        "/catalogue?view=providers",
      );
      expect(unauthorizedTarget({ pathname: "/why-list-here", search: "", previous })).toBe("/why-list-here");
    }
  });

  it("still sends every protected page to sign-in", () => {
    for (const pathname of ["/funding", "/provider", "/provider/setup", "/toolsets/mine", "/explore", "/spend/calls"]) {
      expect(unauthorizedTarget({ pathname, search: "", previous: "did:privy:1" })).toMatch(/^\/login\?next=/);
      expect(unauthorizedTarget({ pathname, search: "", previous: null })).toMatch(/^\/login\?next=/);
    }
  });
});

describe("isPublicPath", () => {
  it("matches the public pages and the pages under the catalogue", () => {
    for (const path of [
      "/how-it-works",
      "/why-list-here",
      "/calculator",
      "/catalogue",
      "/catalogue/view",
      "/catalogue/provider",
      "/demo",
      "/reserves",
      "/toolsets/view",
      "/toolsets/handle",
      "/how-it-works/",
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("never matches a signed-in page or a look-alike", () => {
    for (const path of [
      "/",
      "/login",
      "/funding",
      "/explore",
      "/toolsets/mine",
      "/toolsets",
      "/provider",
      "/provider/setup",
      "/operator",
      "/catalogues",
      "/how-it-works-admin",
      "/demo/../funding",
      null,
      undefined,
    ]) {
      expect(isPublicPath(path), String(path)).toBe(false);
    }
  });
});

/** Every `page.tsx` under `dir` as a URL path, `[segment]` filled with a sample value. */
function pagePaths(dir: string, segments: string[] = []): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const group = name.startsWith("(") && name.endsWith(")");
      return pagePaths(full, group ? segments : [...segments, /^\[.+\]$/.test(name) ? "sample" : name]);
    }
    return name === "page.tsx" ? ["/" + segments.join("/")] : [];
  });
}

describe("isPublicPath and the route groups", () => {
  const APP = join(__dirname, "../app");

  it("covers every page of the (public) group", () => {
    const pages = pagePaths(join(APP, "(public)"));
    expect(pages.length).toBeGreaterThan(5);
    expect(pages.filter((path) => !isPublicPath(path))).toEqual([]);
  });

  it("covers no page of a signed-in group", () => {
    const pages = ["(main)", "(console)", "(minimal)", "(operator)"].flatMap((group) => pagePaths(join(APP, group)));
    expect(pages.length).toBeGreaterThan(20);
    expect(pages.filter((path) => isPublicPath(path))).toEqual([]);
  });
});

describe("handleUnauthorized", () => {
  function unauthorizedEffects() {
    return {
      clearSessionToken: vi.fn(),
      clearCache: vi.fn(),
      resetCache: vi.fn(),
      logout: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(),
    };
  }

  it("on a public page: clears the token and the data, signs out, and stays", () => {
    const fx = unauthorizedEffects();
    handleUnauthorized({ pathname: "/how-it-works", search: "", previous: "did:privy:1" }, fx);
    expect(fx.clearSessionToken).toHaveBeenCalledTimes(1);
    expect(fx.logout).toHaveBeenCalledTimes(1);
    // The page stays mounted: its queries must be told (reset), not stranded (clear).
    expect(fx.resetCache).toHaveBeenCalledTimes(1);
    expect(fx.clearCache).not.toHaveBeenCalled();
    expect(fx.navigate).not.toHaveBeenCalled();
  });

  it("on a protected page: clears the token and the data, signs out, and goes to sign-in", () => {
    const fx = unauthorizedEffects();
    handleUnauthorized({ pathname: "/funding", search: "", previous: "did:privy:1" }, fx);
    expect(fx.clearSessionToken).toHaveBeenCalledTimes(1);
    expect(fx.logout).toHaveBeenCalledTimes(1);
    expect(fx.clearCache).toHaveBeenCalledTimes(1);
    expect(fx.navigate).toHaveBeenCalledWith("/login?next=%2Ffunding&reason=expired");
  });

  it("does not wait on, or fail with, a sign-out that rejects", () => {
    const fx = unauthorizedEffects();
    fx.logout.mockImplementation(() => Promise.reject(new Error("privy down")));
    expect(() => handleUnauthorized({ pathname: "/provider", search: "", previous: null }, fx)).not.toThrow();
    expect(fx.navigate).toHaveBeenCalledWith("/login?next=%2Fprovider");
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
