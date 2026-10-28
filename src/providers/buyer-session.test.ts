import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  applyIdentityChange,
  cacheChangeFor,
  handleUnauthorized,
  UNRESOLVED_IDENTITY,
  isOperatorConsolePath,
  needsEmbeddedEvmWallet,
  isPublicPath,
  markPublicShell,
  onPublicShell,
  signedOutLanding,
  showsSignedOut,
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

describe("needsEmbeddedEvmWallet", () => {
  it("an email-only account needs one", () => {
    expect(needsEmbeddedEvmWallet([{ type: "email" }])).toBe(true);
  });
  it("an account with only an embedded Solana wallet or an external EVM wallet still needs one", () => {
    expect(needsEmbeddedEvmWallet([{ type: "wallet", walletClientType: "privy", chainType: "solana" }])).toBe(true);
    expect(needsEmbeddedEvmWallet([{ type: "wallet", walletClientType: "metamask", chainType: "ethereum" }])).toBe(true);
  });
  it("an account with an embedded EVM wallet does not", () => {
    expect(
      needsEmbeddedEvmWallet([{ type: "email" }, { type: "wallet", walletClientType: "privy", chainType: "ethereum" }]),
    ).toBe(false);
  });
});

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

  /* F3: a reload whose early requests all carried this identity's token. */
  it("on the first identity of a page load, refetches only failures when every request already carried its token", async () => {
    const fx = { ...effects(), sentAs: vi.fn((identity: string) => (identity === "did:privy:buyer" ? ("only" as const) : ("other" as const))) };
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:buyer", previous: undefined },
      fx,
    );
    await flush();

    expect(fx.sentAs).toHaveBeenCalledWith("did:privy:buyer");
    // Only the failed queries are refetched (see identity-cache.test.ts).
    expect(fx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(fx.queryClient.invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    expect(fx.queryClient.resetQueries).not.toHaveBeenCalled();
    // The rest of the login path still runs.
    expect(fx.resetWalletLink).toHaveBeenCalledTimes(1);
    expect(fx.startWalletLink).toHaveBeenCalledTimes(1);
  });

  it("on the first identity of a page load, refetches when some request did not carry its token", () => {
    const fx = { ...effects(), sentAs: vi.fn(() => "unknown" as const) };
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:buyer", previous: undefined },
      fx,
    );
    expect(fx.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(fx.queryClient.invalidateQueries).toHaveBeenCalledWith();
  });

  it("always resets on a switch of identity, whatever the requests carried", () => {
    const fx = { ...effects(), sentAs: vi.fn(() => "only" as const) };
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:b", previous: "did:privy:a" },
      fx,
    );
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: false, identity: null, previous: "did:privy:b" },
      fx,
    );
    expect(fx.sentAs).not.toHaveBeenCalled();
    expect(fx.queryClient.resetQueries).toHaveBeenCalledTimes(2);
    expect(fx.queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("drops the cache when the first identity's early requests went out as someone else", () => {
    const fx = { ...effects(), sentAs: vi.fn(() => "other" as const) };
    applyIdentityChange(
      { onOperatorConsole: false, authenticated: true, identity: "did:privy:buyer", previous: undefined },
      fx,
    );
    expect(fx.queryClient.resetQueries).toHaveBeenCalledTimes(1);
    expect(fx.queryClient.invalidateQueries).not.toHaveBeenCalled();
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

// BUG-BUY-CONNECT-02: only these two app-connection pages stay for a signed-out visitor.
describe("unauthorizedTarget on the app-connection pages", () => {
  it("keeps the error page and the consent page without a request", () => {
    expect(unauthorizedTarget({ pathname: "/connect/authorize-error", search: "?reason=client_unknown", previous: null })).toBe(
      "/connect/authorize-error?reason=client_unknown",
    );
    expect(unauthorizedTarget({ pathname: "/connect/authorize", search: "", previous: null, consentRequest: false })).toBe(
      "/connect/authorize",
    );
  });

  it("still sends the consent page with a request, and every other page, to sign-in", () => {
    expect(unauthorizedTarget({ pathname: "/connect/authorize", search: "", previous: null, consentRequest: true })).toBe(
      "/login?next=%2Fconnect%2Fauthorize",
    );
    for (const pathname of ["/connect", "/connect/preview", "/connect/authorize-errors", "/agents/enable-paid", "/funding"]) {
      expect(showsSignedOut(pathname, false), pathname).toBe(false);
      expect(unauthorizedTarget({ pathname, search: "", previous: null })).toMatch(/^\/login\?next=/);
    }
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
      "/analytics",
      "/analytics/",
      "/how-it-works",
      "/why-list-here",
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

/** Every source file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

// B5 review m4: the 404 renders the public shell at an address that is no public path.
describe("the public shell", () => {
  it("counts as public while mounted, and only then", () => {
    expect(onPublicShell()).toBe(false);
    const unmark = markPublicShell();
    expect(onPublicShell()).toBe(true);
    expect(unauthorizedTarget({ pathname: "/no-such-page", search: "", previous: "did:privy:1", publicShell: true })).toBe(
      "/no-such-page",
    );
    unmark();
    unmark();
    expect(onPublicShell()).toBe(false);
  });

  it("is rendered only by the (public) layout and the 404 page", () => {
    const SRC = join(__dirname, "..");
    const users = sources(SRC)
      .filter((file) => !file.endsWith(join("components", "layout", "public-shell.tsx")))
      .filter((file) => readFileSync(file, "utf8").includes("<PublicShell"))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(users).toEqual([join("app", "(public)", "layout.tsx"), join("app", "not-found.tsx")]);
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
    expect(handleUnauthorized({ pathname: "/how-it-works", search: "", previous: "did:privy:1" }, fx)).toBe("stay");
    expect(fx.clearSessionToken).toHaveBeenCalledTimes(1);
    expect(fx.logout).toHaveBeenCalledTimes(1);
    // The page stays mounted: its queries must be told (reset), not stranded (clear).
    expect(fx.resetCache).toHaveBeenCalledTimes(1);
    expect(fx.clearCache).not.toHaveBeenCalled();
    expect(fx.navigate).not.toHaveBeenCalled();
  });

  it("on a protected page: clears the token and the data, signs out, and goes to sign-in", () => {
    const fx = unauthorizedEffects();
    expect(handleUnauthorized({ pathname: "/funding", search: "", previous: "did:privy:1" }, fx)).toBe("navigate");
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

describe("cacheChangeFor", () => {
  const only = () => "only" as const;
  const other = () => "other" as const;
  const unknown = () => "unknown" as const;

  it("a later change is always a switch", () => {
    expect(cacheChangeFor("did:privy:b", "did:privy:a", only)).toBe("switch");
    expect(cacheChangeFor(null, "did:privy:a", only)).toBe("switch");
    expect(cacheChangeFor("did:privy:a", null, only)).toBe("switch");
  });

  it("the first identity: served, switch or boot by who the requests went out as", () => {
    expect(cacheChangeFor("did:privy:a", undefined, only)).toBe("served");
    expect(cacheChangeFor("did:privy:a", undefined, other)).toBe("switch");
    expect(cacheChangeFor("did:privy:a", undefined, unknown)).toBe("boot");
    expect(cacheChangeFor("did:privy:a", undefined, undefined)).toBe("boot");
  });

  /* Review minor 6: Privy signed in, its `user` not loaded yet. */
  it("a signed-in session whose user has not loaded is never taken for someone else", () => {
    const sentAs = vi.fn(other);
    expect(cacheChangeFor(UNRESOLVED_IDENTITY, undefined, sentAs)).toBe("boot");
    expect(sentAs).not.toHaveBeenCalled();
    expect(cacheChangeFor(UNRESOLVED_IDENTITY, "did:privy:a", only)).toBe("switch");
  });

  it("the identity that replaces it: served only when every request carried its token, otherwise reset", () => {
    expect(cacheChangeFor("did:privy:a", UNRESOLVED_IDENTITY, only)).toBe("served");
    expect(cacheChangeFor("did:privy:a", UNRESOLVED_IDENTITY, other)).toBe("switch");
    expect(cacheChangeFor("did:privy:a", UNRESOLVED_IDENTITY, unknown)).toBe("switch");
    expect(cacheChangeFor("did:privy:a", UNRESOLVED_IDENTITY, undefined)).toBe("switch");
    expect(cacheChangeFor(null, UNRESOLVED_IDENTITY, only)).toBe("switch");
  });
});
