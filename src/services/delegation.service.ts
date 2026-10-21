import type {
  CreateDelegateIntentBody,
  DelegateIntent,
  EscrowUnsettled,
  ListEscrowDelegates,
  RelayedDelegate,
} from "@/interfaces";

import { api } from "./api";

/**
 * `/escrow/delegates` — agent payment delegation. Every route is the payer's
 * (HUMAN session only); the agent's own credential is refused.
 *
 * The same URL on every read. It used to carry a `v` cache-buster from when
 * the API answered `max-age=10` and a read right after a revoke came from the
 * browser's cache; it answers `private, no-cache` now, so the browser
 * revalidates every read, and a fresh URL per read only defeated the caches.
 */
export function listDelegates(): Promise<ListEscrowDelegates> {
  return api.get<ListEscrowDelegates>("/escrow/delegates");
}

export function createDelegateIntent(
  body: CreateDelegateIntentBody,
): Promise<DelegateIntent> {
  return api.post<DelegateIntent>("/escrow/delegates/intent", body);
}

export function submitDelegate(
  body: Record<string, unknown>,
): Promise<RelayedDelegate> {
  return api.post<RelayedDelegate>("/escrow/delegates", body);
}

export function createRevokeDelegateIntent(
  delegate: string,
): Promise<DelegateIntent> {
  return api.post<DelegateIntent>("/escrow/delegates/revoke-intent", {
    delegate,
  });
}

export function submitRevokeDelegate(
  body: Record<string, unknown>,
): Promise<RelayedDelegate> {
  return api.post<RelayedDelegate>("/escrow/delegates/revoke", body);
}

/**
 * `GET /escrow/unsettled` — the payer's payments still being settled, beside
 * the escrow's own window (BUG-D1-07). `bust` defeats the browser cache for a
 * screen that polls while waiting for them to settle.
 */
export function getEscrowUnsettled(bust = 0): Promise<EscrowUnsettled> {
  return api.get<EscrowUnsettled>("/escrow/unsettled", { v: String(bust) });
}
