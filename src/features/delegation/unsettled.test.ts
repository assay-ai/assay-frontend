import { describe, expect, it } from "vitest";

import { editDelegationForm } from "@/features/delegation/delegation-form";
import type { UnsettledVouchers } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

import {
  editIsUnchanged,
  isUnsettledRefusal,
  strandReasons,
  strandWarning,
  unsettledLine,
} from "./unsettled";

const ASSET = "eip155:46630/erc20:0xDbbC";
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

/**
 * BUG-D1-07, the D1 retest: W = 5, the chain counter about 2.27, one 0.10
 * payment served and not yet redeemed. Lowering W to 2 signed and landed
 * without a word, and that payment would have been refused by the chain.
 */
const RETEST: UnsettledVouchers = {
  count: 1,
  amount: usdg("100000"),
  largest: usdg("100000"),
  windowNeeds: usdg("2370000"),
  redeemableUntil: "2026-10-12T15:27:11.000Z",
};
const GRANT = { maxVoucherAmount: "500000", maxPerWindow: "5000000", validUntil: "1793000000" };

describe("strandReasons (BUG-D1-07)", () => {
  it("names the window when it is lowered below the counter plus the payment in flight", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxPerWindow: "2000000" })).toEqual([
      "maxPerWindow",
    ]);
  });

  it("lets a lowered window through when it still holds them", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxPerWindow: "2370000" })).toEqual([]);
  });

  it("names a per-payment cap below the largest payment in flight", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxVoucherAmount: "50000" })).toEqual([
      "maxVoucherAmount",
    ]);
  });

  it("names an expiry moved before they can be redeemed", () => {
    const before = String(Date.parse(RETEST.redeemableUntil!) / 1000 - 60);
    expect(strandReasons(RETEST, GRANT, { ...GRANT, validUntil: before })).toEqual([
      "validUntil",
    ]);
  });

  it("always warns on a revoke with payments in flight", () => {
    expect(strandReasons(RETEST, GRANT, "revoke")).toEqual(["revoked"]);
  });

  it("never blocks a raise, nor anything once nothing is in flight", () => {
    expect(
      strandReasons({ ...RETEST, windowNeeds: usdg("9000000") }, GRANT, {
        ...GRANT,
        maxPerWindow: "6000000",
      }),
    ).toEqual([]);
    expect(
      strandReasons({ ...RETEST, count: 0 }, GRANT, { ...GRANT, maxPerWindow: "1" }),
    ).toEqual([]);
    expect(strandReasons(undefined, GRANT, "revoke")).toEqual([]);
  });
});

describe("unsettledLine / strandWarning", () => {
  it("says how many and how much, in full precision", () => {
    expect(unsettledLine(RETEST, "USDG")).toBe("1 payment (0.100000 USDG) still being settled");
    expect(unsettledLine({ ...RETEST, count: 3, amount: usdg("600000") }, "USDG")).toBe(
      "3 payments (0.600000 USDG) still being settled",
    );
    expect(unsettledLine({ ...RETEST, count: 0 }, "USDG")).toBeNull();
  });

  it("says why, and what it costs", () => {
    expect(strandWarning(["maxPerWindow"], 1)).toContain(
      "leave it unredeemable (together they no longer fit the new 24-hour limit)",
    );
    expect(strandWarning(["maxPerWindow"], 1)).toContain("the provider is not paid");
  });
});

describe("isUnsettledRefusal", () => {
  it("recognises the backend's refusal by code", () => {
    expect(
      isUnsettledRefusal(new ApiError("SETTLEMENT_UNSETTLED_VOUCHERS_AT_RISK", "x", 409)),
    ).toBe(true);
    expect(isUnsettledRefusal(new ApiError("SETTLEMENT_RELAYED_INTENT_REFUSED", "x", 409))).toBe(
      false,
    );
    expect(isUnsettledRefusal(new Error("SETTLEMENT_UNSETTLED_VOUCHERS_AT_RISK"))).toBe(false);
  });
});

/**
 * The D1 retest gap: re-submitting the prefilled caps opened the wallet,
 * because "30 days" recomputes the expiry — a signature for nothing. The edit
 * sheet's primary action now waits for a change.
 */
describe("editIsUnchanged", () => {
  const now = Date.parse("2026-10-12T14:40:00Z") / 1000;
  const seeded = editDelegationForm(
    {
      maxVoucherAmount: usdg("500000"),
      maxPerWindow: usdg("2000000"),
      validUntil: "2026-11-11T14:40:00.000Z",
    },
    now,
  );

  it("is unchanged as prefilled, and with the same amounts written differently", () => {
    expect(seeded).toEqual({ maxVoucherAmount: "0.5", maxPerWindow: "2", validDays: "30" });
    expect(editIsUnchanged(seeded, { ...seeded })).toBe(true);
    expect(editIsUnchanged(seeded, { ...seeded, maxVoucherAmount: "0.50 " })).toBe(true);
  });

  it("is changed by any cap or by the expiry", () => {
    expect(editIsUnchanged(seeded, { ...seeded, maxPerWindow: "5" })).toBe(false);
    expect(editIsUnchanged(seeded, { ...seeded, validDays: "29" })).toBe(false);
    expect(editIsUnchanged(seeded, { ...seeded, maxVoucherAmount: "abc" })).toBe(false);
  });

  it("is never 'unchanged' for a new grant", () => {
    expect(editIsUnchanged(null, seeded)).toBe(false);
  });
});
