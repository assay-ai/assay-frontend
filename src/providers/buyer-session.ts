import type { QueryClient } from "@tanstack/react-query";

import { loginHref } from "@/libs/login-redirect";

import { settleCacheForIdentity } from "./identity-cache";

/**
 * Whether `pathname` belongs to the operator console (`app/(operator)`).
 *
 * The console has its own session (`libs/operator-session.ts`) and must never
 * touch the buyer or provider one. `PrivySessionBridge` sits in the root
 * layout, so without this check a Privy login on the operator sign-in screen
 * ran the buyer login path: it stored the Privy token as the buyer
 * `accessToken` and called `POST /auth/wallet/link`, which provisions a buyer
 * organization for that Privy identity on first sight and links its embedded
 * wallet as that organization's spending account.
 */
export function isOperatorConsolePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/operator" || pathname.startsWith("/operator/");
}

/** What the bridge does when Privy settles on an identity. Injected for tests. */
export interface BuyerSessionEffects {
  queryClient: QueryClient;
  resetWalletLink: () => void;
  clearSessionToken: () => void;
  getAccessToken: () => Promise<string | null>;
  setSessionToken: (token: string) => void;
  startWalletLink: () => void;
}

export interface IdentityChange {
  /** `isOperatorConsolePath` of the current route. */
  onOperatorConsole: boolean;
  authenticated: boolean;
  /** The Privy user id, or `null` when signed out. */
  identity: string | null;
  /** `undefined` = this page load has not reacted to an identity yet. */
  previous: string | null | undefined;
}

/**
 * The buyer side of a Privy identity change, or nothing on an operator page.
 *
 * Returns the identity the bridge has now reacted to (to store as `previous`)
 * and a cancel function for the pending token read. On an operator page it
 * returns `previous` unchanged, so the first buyer page visited afterwards
 * still sees the identity as new and runs the login path then, where it
 * belongs.
 */
export function applyIdentityChange(
  change: IdentityChange,
  effects: BuyerSessionEffects,
): { reacted: string | null | undefined; cancel: () => void } {
  const noop = () => undefined;
  if (change.onOperatorConsole) {
    return { reacted: change.previous, cancel: noop };
  }

  const { identity, previous } = change;
  // A signed-out page load is not a change: nothing to reset or clear.
  if (identity === (previous ?? null)) return { reacted: identity, cancel: noop };

  settleCacheForIdentity(effects.queryClient, previous === undefined ? "boot" : "switch");
  // Whose wallet was being linked is part of who was signed in.
  effects.resetWalletLink();

  if (!change.authenticated) {
    effects.clearSessionToken();
    return { reacted: identity, cancel: noop };
  }

  let cancelled = false;
  void effects.getAccessToken().then((token) => {
    if (cancelled || !token) return;
    // Requests get their token from the registered provider; this write is
    // for code that reads `localStorage` directly.
    effects.setSessionToken(token);
    // Strictly after the token is stored: the request carries it.
    effects.startWalletLink();
  });

  return {
    reacted: identity,
    cancel: () => {
      cancelled = true;
    },
  };
}

/**
 * The pages anyone may read without signing in: the `(public)` route group.
 * Exact paths, plus everything under `/catalogue/`. `/toolsets/view` and
 * `/toolsets/handle` are public, while `/toolsets/mine` is the signed-in list,
 * so `/toolsets` is matched page by page, never as a prefix.
 */
const PUBLIC_PAGES = new Set([
  "/how-it-works",
  "/why-list-here",
  "/calculator",
  "/catalogue",
  "/demo",
  "/reserves",
  "/toolsets/view",
  "/toolsets/handle",
]);
const PUBLIC_PREFIXES = ["/catalogue/"];

/** Whether `pathname` is a public page, readable with no session. */
export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith("/") || pathname.split("/").some((seg) => seg === ".." || seg === ".")) {
    return false;
  }
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PAGES.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Where a buyer-API 401 sends this page.
 *
 * A public page stays where it is: it needs no session, so a dead token
 * (cleared by `handleUnauthorized`) is no reason to put sign-in in front of
 * it. A stale token on How it works used to end at
 * `/login?next=%2Fhow-it-works`.
 *
 * Every other page still goes to sign-in. "Your session expired" is only true
 * when this page load actually had a signed-in identity (`previous` is a
 * string). A visitor who never signed in is not told their session expired:
 * on `/` they get the product's front page (How it works), anywhere else plain
 * sign-in that returns them here.
 */
export function unauthorizedTarget(input: {
  pathname: string;
  search: string;
  /** The identity this page load last resolved: string = signed in, null = signed out, undefined = not resolved yet. */
  previous: string | null | undefined;
}): string {
  if (isPublicPath(input.pathname)) return `${input.pathname}${input.search}`;
  const hadSession = typeof input.previous === "string";
  if (!hadSession && input.pathname === "/") return "/how-it-works";
  return loginHref({ next: `${input.pathname}${input.search}`, reason: hadSession ? "expired" : undefined });
}

/** What a 401 does to this page. Injected for tests. */
export interface UnauthorizedEffects {
  clearSessionToken: () => void;
  /** Drop every query: the page is about to be replaced. */
  clearCache: () => void;
  /** Empty every query and refetch the mounted ones: the page stays. */
  resetCache: () => void;
  logout: () => Promise<unknown>;
  navigate: (href: string) => void;
}

/**
 * The buyer API refused this page's session (after `ApiClient`'s one refresh
 * and retry). On every page the dead token is cleared, the data it fetched is
 * dropped and the Privy session is ended: a cleared local token with a live
 * Privy session would silently re-authenticate on the next mount and mask the
 * expiry. Then a protected page goes to sign-in, and a public page stays put,
 * its queries reset so they refetch without the token.
 */
export function handleUnauthorized(
  input: { pathname: string; search: string; previous: string | null | undefined },
  effects: UnauthorizedEffects,
): void {
  effects.clearSessionToken();
  const target = unauthorizedTarget(input);
  const stay = target === `${input.pathname}${input.search}`;
  if (stay) effects.resetCache();
  else effects.clearCache();
  // Best-effort: the redirect must not wait on it or get blocked by it failing.
  void effects.logout().catch(() => {});
  if (!stay) effects.navigate(target);
}

/**
 * A signed-out visitor at the bare domain sees the product, not an empty
 * console: `/` goes to How it works once Privy has settled. Never on a demo
 * build, whose `/` is the demo console, and never while Privy is resolving.
 */
export function signedOutLanding(input: {
  ready: boolean;
  authenticated: boolean;
  pathname: string;
  demo: boolean;
}): string | null {
  if (input.demo || !input.ready || input.authenticated) return null;
  return input.pathname === "/" ? "/how-it-works" : null;
}
