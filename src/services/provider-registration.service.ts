import type {
  CheckConnectivityResponse,
  ProviderRegistrationRecord,
  ProviderRegistrationState,
  RegisterProviderBody,
  UpdateProviderAccountBody,
} from "@/interfaces";

import { api } from "./api";

/**
 * Registration and onboarding (`providers`, `providers/me/registration`) plus
 * the connectivity probe onboarding step 3 runs.
 *
 * `organizationId` is never sent. It comes off the session token on every one
 * of these routes, and `POST /providers` has no id field at all — accepting
 * one would let any caller with a valid token register or edit another
 * tenant's provider by naming a different id.
 *
 * The connectivity pair (`connectivity-check`, `endpoint`) lives
 * on its own backend controller and was not in this task's list. It is here
 * because `ProviderRegistrationState` already carries
 * `lastConnectivityCheck`, so the onboarding screen reads the check's result
 * whether or not it can run one — see the report.
 */

/**
 * `POST /providers` — register the calling organization.
 *
 * Open: there is no approval step and no `PENDING` state, so the 201 body is
 * the finished row. `409 PROVIDER_ALREADY_REGISTERED` means read the
 * registration instead.
 *
 * The terms versions in the body must equal the currently published ones —
 * read them from `getProviderRegistration().terms` rather than hardcoding, or
 * this answers `PROVIDER_TERMS_VERSION_MISMATCH` the day they move.
 */
export function registerProvider(
  body: RegisterProviderBody
): Promise<ProviderRegistrationRecord> {
  return api.post<ProviderRegistrationRecord>("/providers", body);
}

/**
 * `GET /providers/me/registration` — the whole onboarding state in one call:
 * The row, the four steps with their status, the published terms and the last
 * connectivity check.
 *
 * `404 PROVIDER_NOT_FOUND` = this organization has not registered yet.
 */
export function getProviderRegistration(): Promise<ProviderRegistrationState> {
  return api.get<ProviderRegistrationState>("/providers/me/registration");
}

/**
 * `PATCH /providers/me/registration` — legal name, contacts, timezone, and
 * optionally a re-acceptance of moved terms.
 *
 * Send only what changed. Including `acceptedTerms` re-stamps the acceptance;
 * omitting it leaves the existing one untouched. Neither `endpoint` nor a
 * chain's payout address can be written here — each has its own proved flow,
 * and since per-chain enrolment the address is not even a column on the row this patch
 * writes.
 */
export function updateProviderRegistration(
  body: UpdateProviderAccountBody
): Promise<ProviderRegistrationState> {
  return api.patch<ProviderRegistrationState>("/providers/me/registration", body);
}

/**
 * `POST /providers/me/connectivity-check` — probe an endpoint from the
 * platform. Never saves.
 *
 * Omit `endpoint` to re-probe whatever is already on the row; pass one to test
 * a URL the provider is still typing. Always answers 200, `UNREACHABLE` and
 * `BLOCKED` included — the outcome is the payload, not an error. Only a 400
 * (nothing given and nothing saved: `PROVIDER_ENDPOINT_NOT_DECLARED`) throws.
 */
export function checkProviderConnectivity(endpoint?: string): Promise<CheckConnectivityResponse> {
  return api.post<CheckConnectivityResponse>(
    "/providers/me/connectivity-check",
    endpoint === undefined ? {} : { endpoint }
  );
}

/**
 * `PUT /providers/me/endpoint` — declare and save, gated on reachability.
 *
 * A check that comes back anything other than `REACHABLE` is rejected on the
 * spot and nothing is written; the response carries `saved: true` only when
 * the row actually moved.
 */
export function declareProviderEndpoint(endpoint: string): Promise<CheckConnectivityResponse> {
  return api.put<CheckConnectivityResponse>("/providers/me/endpoint", { endpoint });
}
