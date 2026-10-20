import { queryOptions } from "@tanstack/react-query";

import { getProviderMe } from "@/services/provider-profile.service";
import type { ProviderRegistrationState } from "@/interfaces";
import type { ApiError } from "@/libs/ApiClient";
import { getProviderRegistration } from "@/services/provider-registration.service";
import { getProviderStake } from "@/services/provider-stake.service";
import { listToolBindings } from "@/services/provider-tool-bindings.service";

/**
 * The provider console's shared reads: one key, one request and one freshness
 * per endpoint, whichever screens read it (the shell, home, capital,
 * portfolio, a binding, the setup). A screen adds what is its own (`enabled`,
 * `select`, its poll) on top.
 */
export const providerQueries = {
  /** `GET /providers/me/registration`. */
  registration: () => queryOptions<ProviderRegistrationState, ApiError>({ queryKey: ["provider", "registration"], queryFn: getProviderRegistration, retry: 0 }),
  /** The first 50 bindings (`GET /providers/me/tool-bindings?limit=50`): the sidebar, home and the stake screens. */
  bindings: () =>
    queryOptions({ queryKey: ["provider", "tool-bindings", "sidebar"], queryFn: () => listToolBindings({ limit: 50 }), retry: 0 }),
  /** `GET /providers/me/stake`. */
  stake: () => queryOptions({ queryKey: ["provider", "stake"], queryFn: getProviderStake, retry: 0 }),
  /** `GET /providers/me`: who the provider is, and whether a slash hold is on. */
  me: () => queryOptions({ queryKey: ["provider", "me"], queryFn: getProviderMe, retry: 0 }),
};
