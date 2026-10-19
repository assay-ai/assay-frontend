import type { CursorPage, ListProviderPayoutsQuery, ProviderPayout } from "@/interfaces";

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
