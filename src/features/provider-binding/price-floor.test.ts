import { describe, expect, it } from "vitest";

import type { ToolBindingDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

import { minPaidPriceHint, minPaidPriceOf, priceFloorError } from "./price-floor";
import { liveFormOf, parseLiveForm } from "./wizard/live-stage";

const ASSET = { assetId: "eip155:46630/erc20:0xa", symbol: "USDG", decimals: 6, minPaidPrice: "100000" };

function binding(patch: Partial<ToolBindingDetail> = {}): ToolBindingDetail {
  return {
    id: "b1",
    pricingMode: "FREE",
    price: { amount: "0", asset: ASSET.assetId, decimals: 6 },
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.02,
    timeoutMs: 10000,
    ...patch,
  } as unknown as ToolBindingDetail;
}

describe("the paid-call minimum", () => {
  it("reads the floor off the catalogue, and none for '0' or an older API", () => {
    expect(minPaidPriceHint(ASSET)).toBe("Minimum $0.10 per paid call.");
    expect(minPaidPriceOf({ ...ASSET, minPaidPrice: "0" })).toBeNull();
    expect(minPaidPriceOf({ ...ASSET, minPaidPrice: undefined })).toBeNull();
    // Never truncated below the real minimum.
    expect(minPaidPriceHint({ ...ASSET, minPaidPrice: "105000" })).toBe("Minimum $0.105 per paid call.");
  });

  it("refuses a paid price below it on the form", () => {
    const form = { ...liveFormOf(binding(), null), choice: "paid" as const, price: "0.05" };
    expect(parseLiveForm(form, binding(), ASSET).errors.price).toBe("At least $0.10 per paid call. Choose Free for no charge.");
    expect(parseLiveForm({ ...form, price: "0.10" }, binding(), ASSET).errors.price).toBeUndefined();
    // Free + paid too.
    expect(parseLiveForm({ ...form, choice: "free-paid" }, binding(), ASSET).errors.price).toMatch(/At least \$0\.10/);
    // No floor from the API: no client check.
    expect(parseLiveForm(form, binding(), { ...ASSET, minPaidPrice: "0" }).errors.price).toBeUndefined();
  });

  it("leaves alone a listing priced below it before the floor, while its price is not changed", () => {
    const old = binding({ pricingMode: "PAID", price: { amount: "50000", asset: ASSET.assetId, decimals: 6 } });
    const form = { ...liveFormOf(old, null), timeoutSeconds: "20" };
    const parsed = parseLiveForm(form, old, ASSET);
    expect(parsed.errors.price).toBeUndefined();
    expect(parsed.body).toEqual({ timeoutMs: 20000 });
    expect(parseLiveForm({ ...form, price: "0.06" }, old, ASSET).errors.price).toMatch(/At least \$0\.10/);
  });

  it("maps the API's refusal to the price field, preferring the minimum it names", () => {
    const named = new ApiError("PROVIDER_BINDING_PRICE_BELOW_MINIMUM", "x", 400, "/p", { minimumAmount: "200000", decimals: 6 });
    expect(priceFloorError(named, ASSET)).toBe("At least $0.20 per paid call. Choose Free for no charge.");
    expect(priceFloorError(new ApiError("PROVIDER_BINDING_PRICE_BELOW_MINIMUM", "x", 400), ASSET)).toBe("At least $0.10 per paid call. Choose Free for no charge.");
    expect(priceFloorError(new ApiError("PROVIDER_BINDING_PRICE_NOT_POSITIVE", "x", 400), ASSET)).toBeNull();
  });
});
