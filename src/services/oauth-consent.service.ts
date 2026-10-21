import type { ConsentRequest } from "@/features/oauth/consent";

import { api } from "./api";

/**
 * `{API}/oauth/requests/{rid}`: the consent page's API (spec §6.3.5). A
 * person's Privy session only; an agent key or an app's token is refused.
 *
 * The request id is a path segment here and nowhere else.
 */

/** Reads the request. The first organization to read it owns it; any other gets 404. */
export function getOAuthRequest(rid: string): Promise<ConsentRequest> {
  return api.get<ConsentRequest>(`/oauth/requests/${encodeURIComponent(rid)}`);
}

/** Approves it as `agentId`. Mints nothing: the page then navigates to `redirectTo`. */
export function approveOAuthRequest(rid: string, body: { agentId: string; name: string }): Promise<{ redirectTo: string }> {
  return api.post<{ redirectTo: string }>(`/oauth/requests/${encodeURIComponent(rid)}/approve`, body);
}

/** Refuses it. The page then navigates to `redirectTo`, which returns `access_denied` to the app. */
export function denyOAuthRequest(rid: string): Promise<{ redirectTo: string }> {
  return api.post<{ redirectTo: string }>(`/oauth/requests/${encodeURIComponent(rid)}/deny`);
}
