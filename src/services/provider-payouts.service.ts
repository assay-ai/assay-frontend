import type { CursorPage, ListProviderPayoutsQuery, PayoutCadence, PayoutSchedule, ProviderPayout } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

import { api } from "./api";

/**
 * `GET /providers/me/payouts` — every payment to the provider's wallet, newest
 * first: rail-B redemptions (`kind: "REDEMPTION"`, one per transaction, with
 * its call count).
 *
 * Sortable field: `createdAt` only.
 */
export function listProviderPayouts(
  query: ListProviderPayoutsQuery = {}
): Promise<CursorPage<ProviderPayout>> {
  return api.get<CursorPage<ProviderPayout>>(
    "/providers/me/payouts",
    query as Record<string, unknown>
  );
}

/**
 * The payouts paid in `asset` — the provider's display asset. `undefined` means
 * a one-asset provider, and every payout stays. Money in two assets must never
 * be listed or summed together, so a screen scopes its payouts with this first.
 */
export function payoutsInAsset(
  payouts: readonly ProviderPayout[],
  asset: string | undefined
): ProviderPayout[] {
  return asset ? payouts.filter((payout) => payout.amount.asset === asset) : [...payouts];
}

/**
 * `GET /providers/me/payout-cadence` — the provider's payout cadence and the
 * next run (round-2 SPEC-W2 §8). `null` on a server without it (404), so the
 * Money page hides the setting rather than show an error.
 */
export async function getPayoutSchedule(): Promise<PayoutSchedule | null> {
  try {
    return await api.get<PayoutSchedule>("/providers/me/payout-cadence");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** `PUT /providers/me/payout-cadence` — applies from the next run (API-W2 §3.1). */
export function setPayoutCadence(cadence: PayoutCadence): Promise<PayoutSchedule> {
  return api.put<PayoutSchedule>("/providers/me/payout-cadence", { cadence });
}
