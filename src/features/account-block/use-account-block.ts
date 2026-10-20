"use client";

import * as React from "react";

import { useMeStatusPart } from "@/features/me-status/use-me-status";

import {
  getAccountBlockSnapshot,
  getServerAccountBlockSnapshot,
  setAccountBlockConfirmed,
  subscribeAccountBlock,
} from "./state";

/**
 * The block status (`GET /me/status`'s `blockStatus`, the same answer `GET
 * /account/block-status` gives), cached by React Query under one key for the
 * whole app. Mounted by the signed-in shells, never by `/login` or the public
 * pages: without a session the request would 401, and a 401 signs out.
 *
 * Asked once a session exists (see `hasBlockStatusSession`). This is the one
 * observer that polls `/me/status`: refetched every minute and on focus so a
 * lifted block lifts the banner — the refusal-derived one too, see
 * `settleBlockStatus` — and a fresh block shows it, without a reload. A
 * `null` part is this query's error: no banner from it, as before.
 */
export function useAccountBlockStatus() {
  const query = useMeStatusPart("blockStatus", { poll: true });

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
