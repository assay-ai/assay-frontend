import { api } from "./api";

/**
 * The receipt's Meta Bar names the provider and its tier;
 * `GET /receipts/{intentId}` carries only a provider id, so this is the lookup
 * that turns it into words. Added because no existing service covers it.
 */

export interface ProviderVerification {
  providerId: string;
  legalName: string | null;
  verification: {
    verified: boolean;
    verifiedBy: string | null;
    verifiedAt: string | null;
    method: string | null;
    checks: unknown[];
    expiresAt: string | null;
    evidenceUrl: string | null;
  };
}

/** GET /providers/{providerId}/verification — informational, never a gate. */
export function getProviderVerification(providerId: string): Promise<ProviderVerification> {
  return api.get<ProviderVerification>(`/providers/${providerId}/verification`);
}
