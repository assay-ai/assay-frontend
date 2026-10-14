"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { getSessionToken } from "@/libs/ApiClient";
import { getAccountBlockStatus } from "@/services/account-block.service";

import {
  getAccountBlockSnapshot,
  getServerAccountBlockSnapshot,
  hasBlockStatusSession,
  setAccountBlockConfirmed,
  settleBlockStatus,
  subscribeAccountBlock,
} from "./state";

export const ACCOUNT_BLOCK_STATUS_KEY = ["account", "block-status"] as const;

/**
 * `GET /account/block-status`, cached by React Query under one key for the
 * whole app. Mounted by the signed-in shells, never by `/login` or the public
 * pages: without a session the request would 401, and a 401 signs out.
 *
 * Asked once a session exists (see `hasBlockStatusSession`). Refetched every
 * minute and on focus so a lifted block lifts the banner — the refusal-derived
 * one too, see `settleBlockStatus` — and a fresh block shows it, without a
 * reload.
 */
export function useAccountBlockStatus() {
  const { ready, authenticated } = usePrivy();
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  React.useEffect(() => setHasStoredToken(getSessionToken() !== null), []);

  const query = useQuery({
    queryKey: ACCOUNT_BLOCK_STATUS_KEY,
    queryFn: async () => {
      const requestedAt = Date.now();
      const status = await getAccountBlockStatus();
      // Before the `confirmed` effect below: a lifted confirmed block clears its refusals.
      settleBlockStatus(status.blocked === true, requestedAt);
      return status;
    },
    // Not `ready` alone: on a token-based session Privy may never become ready.
    enabled: hasBlockStatusSession({ ready, authenticated, hasStoredToken }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 0,
  });

  // The write guard in `ApiClient` reads the confirmed flag from the store.
  const blocked = query.data?.blocked === true;
  React.useEffect(() => {
    setAccountBlockConfirmed(blocked);
  }, [blocked]);
  React.useEffect(() => () => setAccountBlockConfirmed(false), []);

  return query;
}

/** The store, as React state. */
export function useAccountBlockSnapshot() {
  return React.useSyncExternalStore(
    subscribeAccountBlock,
    getAccountBlockSnapshot,
    getServerAccountBlockSnapshot,
  );
}

/**
 * True while this account is confirmed blocked. Screens disable their main
 * write actions with it; the global guard in `ApiClient` refuses whatever a
 * screen did not disable.
 */
export function useAccountReadOnly(): boolean {
  return useAccountBlockSnapshot().confirmed;
}
