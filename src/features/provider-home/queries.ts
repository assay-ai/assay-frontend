import { queryOptions } from "@tanstack/react-query";

import { callDisputeKeys } from "@/features/call-disputes/keys";
import { listProviderCallDisputes } from "@/services/call-disputes.service";
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
/** The page size the sidebar's bindings and the open reports are read with; the lists' first pages share it. */
export const PROVIDER_BINDINGS_PAGE = 50;
export const OPEN_REPORTS_PAGE = 50;

export const providerQueries = {
  /** `GET /providers/me/registration`. */
  registration: () => queryOptions<ProviderRegistrationState, ApiError>({ queryKey: ["provider", "registration"], queryFn: getProviderRegistration, retry: 0 }),
  /** The first 50 bindings (`GET /providers/me/tool-bindings?limit=50`): the sidebar, home and the stake screens. */
  bindings: () =>
    queryOptions({ queryKey: ["provider", "tool-bindings", "sidebar"], queryFn: () => listToolBindings({ limit: PROVIDER_BINDINGS_PAGE }), retry: 0 }),
  /** `GET /providers/me/stake`. */
  stake: () => queryOptions({ queryKey: ["provider", "stake"], queryFn: getProviderStake, retry: 0 }),
  /**
   * The open bad-result reports, first 50 (`GET /providers/me/call-disputes?state=OPEN&limit=50`):
   * the nav badge, Home, the Inbox, and the first page of Bad-result reports'
   * Open list. Under `callDisputeKeys.provider`, which every reply invalidates.
   */
  openReports: () =>
    queryOptions({
      queryKey: [...callDisputeKeys.provider, "open"],
      queryFn: () => listProviderCallDisputes({ state: ["OPEN"], limit: OPEN_REPORTS_PAGE }),
      retry: 0,
    }),
  /** `GET /providers/me`: who the provider is, and whether a slash hold is on. */
  me: () => queryOptions({ queryKey: ["provider", "me"], queryFn: getProviderMe, retry: 0 }),
};
