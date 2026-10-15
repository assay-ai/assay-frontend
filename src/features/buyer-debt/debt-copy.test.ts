import { describe, expect, it } from "vitest";

import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";

import {
  callPaymentNote,
  debtBannerDescription,
  debtBannerTitle,
  debtDate,
  debtOutstandingContext,
  debtRefusalSentence,
  splitDebts,
  uncollectedNotWithheld,
} from "./debt-copy";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";

function debt(overrides: Partial<BuyerDebt> = {}): BuyerDebt {
  return {
    intentId: "int_1",
    payer: ACCOUNT,
    amount: { amount: "2500000", asset: ASSET, decimals: 6 },
    providerId: "prv_1",
    toolId: "price_quote",
    cause: "DelegateIsRevoked",
    lapsedAt: "2026-10-16T00:00:00.000Z",
    writeOffAt: "2026-11-15T00:00:00.000Z",
    createdAt: "2026-10-15T23:59:00.000Z",
    ...overrides,
  };
}

describe("the debt banner", () => {
  it("says in plain words what happened, what it blocks and the write-off date", () => {
    expect(debtBannerDescription([debt()])).toBe(
      "A call your agent made could not be collected from your escrow (the agent key that signed it was revoked). " +
        "Paid calls are paused until you settle it. Free calls still work. " +
        "If not settled by 15 Nov 2026, the provider goes unpaid.",
    );
  });

  it("falls back to the raw cause, and says when none was recorded", () => {
    expect(debtBannerDescription([debt({ cause: "SomethingNew" })])).toContain("(SomethingNew)");
    expect(debtBannerDescription([debt({ cause: null })])).toContain("(the reason was not recorded)");
  });

  it("counts several debts and names the earliest write-off", () => {
    const text = debtBannerDescription([
      debt(),
      debt({ intentId: "int_2", writeOffAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(text).toMatch(/^2 calls your agents made/);
    expect(text).toContain("1 Nov 2026 (the earliest)");
    expect(debtBannerTitle([debt(), debt()])).toBe("Settle 2 calls your agents owe for");
  });

  it("titles one debt with its amount", () => {
    expect(debtBannerTitle([debt()])).toMatch(/^Settle .*2\.5000 your agent owes for a call$/);
  });

  it("prints a date in UTC", () => {
    expect(debtDate("2026-11-15T23:30:00.000Z")).toBe("15 Nov 2026");
  });
});

describe("splitDebts", () => {
  it("settles only the session account's own debts", () => {
    const other = debt({ intentId: "int_9", payer: "eip155:46630:0x2222222222222222222222222222222222222222" });
    const { own, others } = splitDebts({ account: ACCOUNT.toLowerCase(), debts: [debt(), other] });
    expect(own.map((d) => d.intentId)).toEqual(["int_1"]);
    expect(others.map((d) => d.intentId)).toEqual(["int_9"]);
    expect(splitDebts(undefined)).toEqual({ own: [], others: [] });
  });
});

describe("the debt refusals", () => {
  const outstanding = new ApiError("PAYMENT_DEBT_OUTSTANDING", "raw", 402, "/x", {
    count: 1,
    owed: "2.50 USDG",
    debts: [debt()],
    settleWith: "GET /escrow/debts, then POST /escrow/debts/{intentId}/voucher",
  });

  it("reads the PAYMENT_DEBT_OUTSTANDING context", () => {
    const ctx = debtOutstandingContext(outstanding);
    expect(ctx?.count).toBe(1);
    expect(ctx?.owed).toBe("2.50 USDG");
    expect(ctx?.debts).toHaveLength(1);
    expect(debtOutstandingContext(new ApiError("OTHER", "x", 400))).toBeNull();
  });

  it("words both codes, and nothing else", () => {
    expect(debtRefusalSentence(outstanding)).toMatch(/^Paid calls are paused: your escrow owes for a call .*\(2\.50 USDG\)/);
    expect(debtRefusalSentence(outstanding)).toContain("Free calls still work");
    expect(debtRefusalSentence(new ApiError("PAYMENT_DEBT_NOT_FOUND", "x", 404))).toMatch(/no longer owed/);
    expect(debtRefusalSentence(new ApiError("OTHER", "x", 400))).toBeNull();
  });
});

describe("call payment notes", () => {
  it("names a debt or a forfeit on a call row, and nothing for an ordinary call", () => {
    expect(callPaymentNote({ debt: "OUTSTANDING" })).toMatch(/not collected yet/);
    expect(callPaymentNote({ debt: "WRITTEN_OFF" })).toMatch(/written off/);
    expect(callPaymentNote({ forfeited: true })).toMatch(/provider forfeited/);
    expect(callPaymentNote({ forfeited: false, debt: null })).toBeNull();
  });

  it("does not count a forfeited or written-off call as withheld", () => {
    expect(uncollectedNotWithheld({ forfeited: true })).toBe(true);
    expect(uncollectedNotWithheld({ debt: "WRITTEN_OFF" })).toBe(true);
    expect(uncollectedNotWithheld({ debt: "OUTSTANDING" })).toBe(false);
    expect(uncollectedNotWithheld({})).toBe(false);
  });
});
