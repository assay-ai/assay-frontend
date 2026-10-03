import { api } from "./api";

/** GET /receipts/{intentId} — the receipt screens. */
export function getReceipt(intentId: string): Promise<unknown> {
  return api.get(`/receipts/${intentId}`);
}

/**
 * GET /receipts/summary — the Spend explorer.
 * The design is explicit that period COMPARISON is the main panel, never a flat
 * list, so this is the endpoint that screen is built on.
 */
export function getReceiptsSummary(params?: {
  from?: string;
  to?: string;
  groupBy?: string;
}): Promise<unknown> {
  return api.get("/receipts/summary", params);
}
