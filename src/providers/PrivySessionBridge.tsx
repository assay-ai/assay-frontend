"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  getWalletLinkStatus,
  resetWalletLink,
  startWalletLink,
  subscribeWalletLink,
} from "@/features/auth/wallet-link";
import { clearSessionToken, onUnauthorized, setSessionToken } from "@/libs/ApiClient";

/**
 * Bridges Privy's client-side auth state onto the axios session used by
 * `ApiClient`. Five jobs, no more:
 *
 *  1. Once Privy is `ready` and `authenticated`, fetch the access token and
 *     write it with `setSessionToken` so every request carries it as
 *     `Authorization: Bearer …`.
 *  2. Clear the React Query cache whenever the identity changes (login,
 *     logout, or a different user) — the token names a tenant, and cached
 *     data from another tenant must not survive the switch. Same reasoning
 *     as the persona switch this replaced.
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
 *     `onUnauthorized` and this is the one place with both. A Privy token
 *     expiring is the first 401 this app has ever had to handle — the old
 *     demo token never did. A 424 (`AUTH_WALLET_NOT_LINKED`) never reaches
 *     this handler: `ApiClient` only calls it for 401, and a brand-new
 *     signup with no wallet yet must not be signed out over a condition
 *     that resolves itself within about a minute.
 *
 * Pure side effect: it always renders `children` unchanged.
 */
export function PrivySessionBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  // Tracks the identity this bridge last reacted to, so a re-render that
  // changes nothing (e.g. an unrelated Privy field updating) does not clear
  // the cache again. `null` covers both "not ready yet" and "signed out".
  const lastIdentityRef = useRef<string | null>(null);

  // Read inside the 401 handler instead of closed over, so a stale closure
  // from an earlier render can't see a stale pathname.
  const pathnameRef = useRef(pathname);
  // Guards against a redirect storm: a screen fires many parallel requests,
  // so several can 401 at once. Only the first one redirects; it resets once
  // a navigation actually lands (see the effect below), so a *later* 401 —
  // on the next page — is free to redirect again.
  const redirectingRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname;
    redirectingRef.current = false;
  }, [pathname]);

  useEffect(() => {
    onUnauthorized(() => {
      // Already on /login, or a redirect is already in flight from an
      // earlier 401 in the same burst: do nothing:
      if (pathnameRef.current === "/login" || redirectingRef.current) return;
      redirectingRef.current = true;

      clearSessionToken();
      queryClient.clear();
      // A cleared local token with a live Privy session would silently
      // re-authenticate on the next mount and mask the expiry, so end the
      // Privy session too. Best-effort: the redirect must not wait on it or
      // get blocked by it failing.
      void logout().catch(() => {});
      router.replace("/login");
    });
  }, [queryClient, router, logout]);

  useEffect(() => {
    if (!ready) return;

    const identity = authenticated ? (user?.id ?? "authenticated") : null;
    if (identity === lastIdentityRef.current) return;
    lastIdentityRef.current = identity;

    queryClient.clear();
    // Whose wallet was being linked is part of who was signed in.
    resetWalletLink();

    if (!authenticated) {
      clearSessionToken();
      return;
    }

    let cancelled = false;
    void getAccessToken().then((token) => {
      if (cancelled || !token) return;
      setSessionToken(token);
      // Strictly after the token is stored: the request carries it.
      startWalletLink();
    });

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user?.id, getAccessToken, queryClient]);

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
