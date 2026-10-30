import type { Money } from "@/interfaces";
import type { CatalogueSettlementAsset } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";
import { formatMoney } from "@/utils/money";

/**
 * The paid-call minimum. Every paid call costs the platform on-chain gas that
 * its fee must cover, so a PAID or FREEMIUM price below the floor (default
 * $0.10) is refused with 400 `PROVIDER_BINDING_PRICE_BELOW_MINIMUM`. The
 * catalogue carries the floor as `settlementAsset.minPaidPrice` (atomic, `'0'`
 * when none applies). The backend judges a price only when an edit sets one,
 * so a listing priced below it before the floor existed keeps its other edits;
 * the form checks the same way. Pure.
 */

export const PRICE_BELOW_MINIMUM = "PROVIDER_BINDING_PRICE_BELOW_MINIMUM";

/** The minimum as money, or null when the API sends none (or `'0'`). */
export function minPaidPriceOf(asset: Pick<CatalogueSettlementAsset, "assetId" | "decimals" | "minPaidPrice"> | null | undefined): Money | null {
  const amount = asset?.minPaidPrice;
  if (!asset || !amount || !/^\d+$/.test(amount) || /^0+$/.test(amount)) return null;
  return { amount, asset: asset.assetId, decimals: asset.decimals };
}

/** "$0.10": never truncated below the real minimum. */
export function minPaidPriceText(min: Money): string {
  return formatMoney(min, { decimals: min.decimals });
}

/** "Minimum $0.10 per paid call." under the price box; null without a minimum. */
export function minPaidPriceHint(asset: Parameters<typeof minPaidPriceOf>[0]): string | null {
  const min = minPaidPriceOf(asset);
  return min ? `Minimum ${minPaidPriceText(min)} per paid call.` : null;
}

/** The field error for a price below the minimum. */
export function belowMinimumText(min: Money): string {
  return `At least ${minPaidPriceText(min)} per paid call. Choose Free for no charge.`;
}

/** True when `amount` (atomic, same asset) is below the minimum. */
export function isBelowMinimum(amount: string, min: Money | null): boolean {
  if (!min || !/^\d+$/.test(amount)) return false;
  return BigInt(amount) < BigInt(min.amount);
}

/**
 * The API's refusal as the price field's error, or null for any other
 * error. The minimum comes from the error's context when it carries one,
 * else from the catalogue.
 */
export function priceFloorError(error: unknown, asset: Parameters<typeof minPaidPriceOf>[0]): string | null {
  if (!(error instanceof ApiError) || error.code !== PRICE_BELOW_MINIMUM) return null;
  const amount = error.context?.minimumAmount;
  const decimals = error.context?.decimals;
  const fromError =
    typeof amount === "string" && /^\d+$/.test(amount) && typeof decimals === "number" && asset
      ? minPaidPriceOf({ ...asset, minPaidPrice: amount, decimals })
      : null;
  const min = fromError ?? minPaidPriceOf(asset);
  return min ? belowMinimumText(min) : "This price is below the paid-call minimum. Raise it, or choose Free for no charge.";
}
