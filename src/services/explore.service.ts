import { api } from "./api";

/**
 * Explore: the Tools, Providers and Provider detail screens.
 *
 * **There is no provider LIST endpoint.** `POST /providers` registers the
 * caller as one, `GET /providers/me*` reads your own, and
 * `GET /providers/{providerId}/verification` reads one you already know the id
 * of. Nothing enumerates the catalogue. So the explorer discovers providers
 * from the only place their ids appear to a buyer — the buyer's own
 * `/tool-calls` feed — and then asks each id for its identity. That is a
 * stand-in for a catalogue endpoint, and it means a provider this
 * organization has never called is invisible here.
 *
 * The verification response is also NOT the flat `ProviderVerificationDto`
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
