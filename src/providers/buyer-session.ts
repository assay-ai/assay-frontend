import type { QueryClient } from "@tanstack/react-query";

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
