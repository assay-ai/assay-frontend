import type { ProviderMe } from "@/interfaces";

import { api } from "./api";

/**
 * `GET /providers/me` — the provider record for the calling organization.
 *
 * The provider's id **is** the organization id; there is no separate lookup
 * and no id to pass. Every route in this family reads it off the session, so
 * none of them takes a provider id in a path or a body — which is the whole
 * of what stops one tenant naming another's.
 *
 * `404 PROVIDER_NOT_FOUND` is the ordinary state of an organization that has
 * not registered yet, not an error to swallow: it is the signal to send the
 * user to onboarding. Branch on `ApiError.code`, never on the message.
 */
export function getProviderMe(): Promise<ProviderMe> {
  return api.get<ProviderMe>("/providers/me");
}
