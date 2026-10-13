import { api } from "./api";
import { resolveDisplayAsset } from "./display-asset";

/** GET /receipts/{intentId} — the receipt screens. */
export function getReceipt(intentId: string): Promise<unknown> {
  return api.get(`/receipts/${intentId}`);
}

/**
 * GET /receipts/summary — the Spend explorer.
 * The design is explicit that period COMPARISON is the main panel, never a flat
 * list, so this is the endpoint that screen is built on.
 *
 * The API answers in one asset and refuses (422) a window that spans two
 * unless `asset` names one. A caller that names none gets the buyer's display
 * asset — see `display-asset.ts` — so a two-asset buyer sees figures, not an
 * error.
 */
export async function getReceiptsSummary(params?: {
  from?: string;
  to?: string;
  groupBy?: string;
  asset?: string;
}): Promise<unknown> {
  const asset = params?.asset ?? (await resolveDisplayAsset());
  return api.get("/receipts/summary", asset ? { ...params, asset } : params);
}
