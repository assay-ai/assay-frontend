import type { CursorPage, ListProviderPayoutsQuery, ProviderPayout } from "@/interfaces";

import { api } from "./api";

/**
 * `GET /providers/me/payouts` — payout batches, newest first.
 *
 * One row per `PAYOUT` ledger entry, not per batch: there is no batch row to
 * paginate. A provider paid out in two assets in the same run gets two rows
 * sharing a `batchId`. Group client-side if the screen wants batches.
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
