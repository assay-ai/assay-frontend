import type {
  CreateDelegateIntentBody,
  DelegateIntent,
  ListEscrowDelegates,
  RelayedDelegate,
} from "@/interfaces";

import { api } from "./api";

/**
 * `/escrow/delegates` — agent payment delegation. Every route is the payer's
 * (HUMAN session only); the agent's own credential is refused.
 *
 * `version` is a cache-buster, for the reason `agents-view.tsx` gives at length:
 * the API answers GETs with `Cache-Control: private, max-age=10`, so a list read
 * right after a revoke would otherwise come from the browser's cache and show
 * the delegate as still authorised.
 */
export function listDelegates(version = 0): Promise<ListEscrowDelegates> {
  return api.get<ListEscrowDelegates>("/escrow/delegates", {
    v: String(version),
  });
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
