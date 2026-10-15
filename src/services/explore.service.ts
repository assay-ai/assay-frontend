import { api } from "./api";

/**
 * Explore: a provider's identity, for the Provider detail screen.
 *
 * The lists themselves (providers, tools, a provider's entry) come from the
 * platform catalogue, `GET /catalogue/*` in `catalogue.service.ts` — every
 * provider with an ACTIVE binding and every tool one of them serves, the same
 * for every caller. Your own `/tool-calls` only decorates those rows with your
 * spend. A tool contract no provider serves yet is not in the catalogue (it is
 * in `GET /tools`, the contract list, which is why that one is longer).
 *
 * The verification response is NOT the flat `ProviderVerificationDto`
 * the OpenAPI document declares. What the running API actually returns is
 * `{ providerId, legalName, verification: { verified, … } }` — verified
 * against http://localhost:3000/api/v1. `legalName` is the only source of a
 * provider's NAME anywhere on the buyer surface, so the wrapper matters.
 */

export interface ProviderVerificationCheck {
  check: string;
  result: "PASS" | "FAIL" | "NOT_CHECKED";
  note: string | null;
}

export interface ProviderVerification {
  /** Informational. Not a gate on registration or on publishing. */
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  method: string | null;
  checks: ProviderVerificationCheck[];
  expiresAt: string | null;
  evidenceUrl: string | null;
}

/** The real response shape, wrapper included. */
export interface ProviderVerificationResponse {
  providerId: string;
  legalName: string | null;
  verification: ProviderVerification;
}

/** GET /providers/{providerId}/verification — the `verified` label and who checked. */
export function getProviderVerification(
  providerId: string
): Promise<ProviderVerificationResponse> {
  return api.get<ProviderVerificationResponse>(`/providers/${providerId}/verification`);
}
