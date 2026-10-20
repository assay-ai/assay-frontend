"use client";

import { useCreateWallet, usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  getWalletLinkStatus,
  resetWalletLink,
  startWalletLink,
  subscribeWalletLink,
} from "@/features/auth/wallet-link";
import {
  clearSessionToken,
  onUnauthorized,
  registerSessionTokenProvider,
  setSessionToken,
} from "@/libs/ApiClient";

import { demoEnabled } from "@/libs/demo/demo-api";
import { appNavigate } from "@/features/oauth/strict-pages";

import {
  applyIdentityChange,
  handleUnauthorized,
  isOperatorConsolePath,
  needsEmbeddedEvmWallet,
  onPublicShell,
  signedOutLanding,
} from "./buyer-session";

/**
 * Bridges Privy's client-side auth state onto the axios session used by
 * `ApiClient`. Six jobs, no more:
 *
 *  1. Register Privy's `getAccessToken` as `ApiClient`'s session token
 *     provider, so every request asks for the token as it goes out and
 *     carries it as `Authorization: Bearer …`. Privy refreshes the token
 *     itself near expiry; a token read once at login and stored went stale
 *     after about an hour and signed everyone out. On a 401 `ApiClient`
 *     refreshes through the same provider and retries once before calling
 *     the handler in (5).
 *  2. Reset the React Query cache whenever the identity changes (login,
 *     logout, or a different user) — the token names a tenant, and cached
 *     data from another tenant must not survive the switch. Same reasoning
 *     as the persona switch this replaced. The first identity a page load
 *     resolves to only refetches; see `identity-cache.ts` for both, and for
 *     why neither is `queryClient.clear()`.
 *  3. On logout, clear the stored token so the next request goes out
 *     unauthenticated instead of replaying a dead one.
 *  4. Start the wallet link the moment a token exists, and clear the whole
 *     React Query cache once it lands. Privy records the wallet AFTER issuing
 *     the token, so a fresh signup's first requests all fail with
 *     `AUTH_WALLET_NOT_LINKED`; `startWalletLink` asks the API to look again
 *     rather than letting its 60-second cooldown decide when. See
 *     `features/auth/wallet-link.ts` — including why this is not the gate that
 *     was tried and removed.
 *  5. Register the `ApiClient` 401 handler. `ApiClient` is a module-level
 *     singleton and cannot import a router or a query client, so it exposes
 *     `onUnauthorized` and this is the one place with both. A protected
 *     page goes to sign-in; a public page stays put with the token cleared
 *     (`handleUnauthorized`). A Privy token
 *     expiring is the first 401 this app has ever had to handle — the old
 *     demo token never did. A 424 (`AUTH_WALLET_NOT_LINKED`) never reaches
 *     this handler: `ApiClient` only calls it for 401, and a brand-new
 *     signup with no wallet yet must not be signed out over a condition
 *     that resolves itself within about a minute.
 *
 *  6. Create the embedded EVM wallet when Privy signed someone in without
 *     one (`needsEmbeddedEvmWallet`): the wallet link in (4) waits for it.
 *
 * None of (2)–(6) runs on the operator console (`/operator…`), which has its
 * own session and must never touch the buyer one — see `buyer-session.ts`.
 *
 * Pure side effect: it always renders `children` unchanged.
 */
/** How long Privy's own `createOnLogin` gets before (6) creates the wallet itself. */
const EMBEDDED_WALLET_GRACE_MS = 5_000;

export function PrivySessionBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  // Privy v3 registers these callbacks on the provider; calling the hook with no
  // argument crashes PrivyProvider ("Cannot destructure property 'onSuccess'").
  const { createWallet } = useCreateWallet({ onSuccess: () => {}, onError: () => {} });
  // The identity a wallet was last asked for, so a re-render never asks twice.
  const walletRequestedForRef = useRef<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  // Tracks the identity this bridge last reacted to, so a re-render that
  // changes nothing (e.g. an unrelated Privy field updating) does not reset
  // the cache again. `undefined` is "this page load has not resolved one
  // yet"; `null` is "signed out".
  const lastIdentityRef = useRef<string | null | undefined>(undefined);

  // Read inside the 401 handler instead of closed over, so a stale closure
  // from an earlier render can't see a stale pathname.
  const pathnameRef = useRef(pathname);
  // Guards against a redirect storm: a screen fires many parallel requests,
  // so several can 401 at once. Only the first one redirects; it resets once
  // a navigation actually lands (see the effect below), so a *later* 401 —
  // on the next page — is free to redirect again.
  const redirectingRef = useRef(false);
  // Set when a 401 left a public page where it was. No navigation will reset
  // `redirectingRef` then, so the next identity change does: someone who signs
  // in again on that page, and whose session later expires, is handled again.
  const stayedRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname;
    redirectingRef.current = false;
    stayedRef.current = false;
  }, [pathname]);

  useEffect(() => {
    registerSessionTokenProvider(() => getAccessToken());
    return () => registerSessionTokenProvider(null);
  }, [getAccessToken]);

  useEffect(() => {
    onUnauthorized(() => {
      // Already on /login, or a redirect is already in flight from an
      // earlier 401 in the same burst: do nothing:
      if (pathnameRef.current === "/login" || redirectingRef.current) return;
      // The operator console never calls the buyer API and must not sign its
      // Privy login out over one; its own 401s are handled by its layout.
      if (isOperatorConsolePath(pathnameRef.current)) return;
      redirectingRef.current = true;

      // The token, the data and the Privy session go on every page. A
      // protected page then goes to sign-in (back here after it; "Your
      // session expired" only when this page load had one; a first-time
      // visitor at `/` gets How it works). A public page stays put: it needs
      // no session.
      const search = typeof window === "undefined" ? "" : window.location.search;
      const outcome = handleUnauthorized(
        { pathname: pathnameRef.current, search, previous: lastIdentityRef.current, publicShell: onPublicShell() },
        {
          clearSessionToken,
          clearCache: () => queryClient.clear(),
          resetCache: () => void queryClient.resetQueries(),
          logout,
          // A strict page (the consent page) leaves its document for sign-in:
          // its policy would refuse the sign-in captcha (`strict-pages.ts`).
          navigate: (href) => appNavigate(router, href, { replace: true, pathname: pathnameRef.current }),
        },
      );
      stayedRef.current = outcome === "stay";
    });
  }, [queryClient, router, logout]);

  // Signed out at the bare domain: show the product, not an empty console.
  useEffect(() => {
    // A 401 redirect in flight (an expired session signing out) wins.
    if (redirectingRef.current) return;
    const target = signedOutLanding({ ready, authenticated, pathname, demo: demoEnabled() });
    if (target) appNavigate(router, target, { replace: true, pathname });
  }, [ready, authenticated, pathname, router]);

  // The operator console has its own session: on its pages the buyer login
  // path (token write, wallet link, cache reset) does not run at all.
  const onOperatorConsole = isOperatorConsolePath(pathname);

  useEffect(() => {
    if (!ready) return;

    const { reacted, cancel } = applyIdentityChange(
      {
        onOperatorConsole,
        authenticated,
        identity: authenticated ? (user?.id ?? "authenticated") : null,
        previous: lastIdentityRef.current,
      },
      {
        queryClient,
        resetWalletLink,
        clearSessionToken,
        getAccessToken,
        setSessionToken,
        startWalletLink,
      },
    );
    // A new identity after a 401 that stayed: the burst is over, so a later 401 is handled again.
    if (reacted !== lastIdentityRef.current && stayedRef.current) {
      stayedRef.current = false;
      redirectingRef.current = false;
    }
    lastIdentityRef.current = reacted;
    return cancel;
  }, [ready, authenticated, user?.id, getAccessToken, queryClient, onOperatorConsole]);

  // (6) Never a second wallet: asked at most once per identity, only after
  // Privy's own `createOnLogin` had its chance (re-checked on the latest user
  // when the delay ends), and `createWallet()` without `createAdditional`
  // refuses outright when the user already has an embedded wallet. A failure
  // is left to the wallet link, whose deadline turns it into the "could not
  // set up your wallet" state.
  useEffect(() => {
    if (!ready || !authenticated || !user || onOperatorConsole || demoEnabled()) return;
    if (!needsEmbeddedEvmWallet(user.linkedAccounts)) return;
    if (walletRequestedForRef.current === user.id) return;
    const id = user.id;
    const timer = setTimeout(() => {
      const latest = userRef.current;
      if (!latest || latest.id !== id || walletRequestedForRef.current === id) return;
      if (!needsEmbeddedEvmWallet(latest.linkedAccounts)) return;
      walletRequestedForRef.current = id;
      createWallet().catch(() => undefined);
    }, EMBEDDED_WALLET_GRACE_MS);
    return () => clearTimeout(timer);
  }, [ready, authenticated, user, onOperatorConsole, createWallet]);

  /*
    A screen that mounted before the wallet linked is holding a failed request
    — the API refused it for want of an account, not for want of data. Once
    the link lands, everything it asked for answers. Every such query is still
    ACTIVE, because nothing here unmounts a screen: the previous attempt at
    this replaced `children` with a gate, and `invalidateQueries` then refetched
    nothing at all because it only refetches observers that still exist.

    `WalletSetupBanner` covers the screens that read outside React Query.
  */
  useEffect(() => {
    let seenLinked = getWalletLinkStatus() === "linked";
    return subscribeWalletLink(() => {
      const linked = getWalletLinkStatus() === "linked";
      if (linked && !seenLinked) void queryClient.invalidateQueries();
      seenLinked = linked;
    });
  }, [queryClient]);

  return <>{children}</>;
}
